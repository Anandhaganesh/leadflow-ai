import { GoogleGenerativeAI } from '@google/generative-ai';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Robust wrapper that retries generating content when rate limits (429) or temporary server errors (500, 503) occur.
 */
async function generateContentWithRetry(model, request, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    try {
      return await model.generateContent(request);
    } catch (error) {
      attempt++;
      const errorMsg = error.message || '';
      const isRateLimitOrTempError = 
        error.status === 429 || 
        error.status === 500 || 
        error.status === 503 ||
        errorMsg.includes('429') || 
        errorMsg.includes('500') || 
        errorMsg.includes('503') ||
        errorMsg.toLowerCase().includes('quota') || 
        errorMsg.toLowerCase().includes('rate limit') || 
        errorMsg.toLowerCase().includes('too many requests') || 
        errorMsg.toLowerCase().includes('overloaded');

      if (isRateLimitOrTempError && attempt <= maxRetries) {
        // Default to exponential backoff (e.g., 4s, 8s, 16s, 32s...)
        let delayMs = Math.pow(2, attempt) * 2000;
        
        // Attempt to parse explicit retry delay from Gemini API error message (e.g. "Please retry in 51.725728339s.")
        const match = errorMsg.match(/retry in ([\d.]+)s/i);
        if (match && match[1]) {
          const parsedSeconds = parseFloat(match[1]);
          if (!isNaN(parsedSeconds)) {
            delayMs = Math.ceil(parsedSeconds * 1000) + 1000; // Add 1s safety buffer
          }
        }

        console.warn(`[AgentEngine] Temporary API error or rate limit hit. Retrying attempt ${attempt}/${maxRetries} in ${delayMs / 1000}s. Error details: ${errorMsg}`);
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Robust wrapper that retries generating content via Hugging Face Inference API.
 * Handles 503 (model loading), 429 (rate limits), and network errors.
 */
async function generateHFContentWithRetry(model, prompt, systemInstruction, hfToken, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    try {
      const messages = [];
      if (systemInstruction) {
        messages.push({ role: "system", content: systemInstruction });
      }
      messages.push({ role: "user", content: prompt });

      const response = await fetch(
        `https://api-inference.huggingface.co/v1/chat/completions`,
        {
          headers: {
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "application/json"
          },
          method: "POST",
          body: JSON.stringify({
            model: model,
            messages: messages,
            max_tokens: 2048
          }),
        }
      );
      
      if (response.ok) {
        const result = await response.json();
        if (result.choices && result.choices[0] && result.choices[0].message) {
          return result.choices[0].message.content;
        } else {
          throw new Error(`Unexpected Hugging Face response format: ${JSON.stringify(result)}`);
        }
      }
      
      attempt++;
      const errorText = await response.text();
      let isRetryable = response.status === 429 || response.status === 503 || response.status === 500;
      
      let delayMs = Math.pow(2, attempt) * 2000;
      
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.estimated_time) {
          delayMs = Math.ceil(errorJson.estimated_time * 1000) + 1000;
          isRetryable = true;
        }
      } catch (e) {}
      
      if (isRetryable && attempt <= maxRetries) {
        console.warn(`[AgentEngine][HF] Attempt ${attempt}/${maxRetries} failed with status ${response.status}. Retrying in ${delayMs / 1000}s... Error: ${errorText}`);
        await sleep(delayMs);
      } else {
        throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
      }
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      attempt++;
      const delayMs = Math.pow(2, attempt) * 2000;
      const causeStr = err.cause ? ` (Cause: ${err.cause.message || err.cause})` : '';
      console.warn(`[AgentEngine][HF] Error. Attempt ${attempt}/${maxRetries}. Retrying in ${delayMs / 1000}s... Error: ${err.message}${causeStr}`);
      await sleep(delayMs);
    }
  }
}

/**
 * Orchestrates the sequential multi-agent research loop using Gemini or Hugging Face.
 */
export async function runSimulation(runId, topic, agents, geminiApiKey, db) {
  try {
    const settings = db.getSettings();
    const apiProvider = settings.apiProvider || 'gemini';
    
    let runStep;
    
    if (apiProvider === 'huggingface') {
      const hfToken = settings.hfToken;
      const hfModel = settings.hfModel || 'Qwen/Qwen2.5-72B-Instruct';
      if (!hfToken || hfToken.trim() === '') {
        throw new Error('Hugging Face API Token is missing. Please configure it in Settings.');
      }
      console.log(`[Simulation][${runId}] Initializing Hugging Face model: ${hfModel}`);
      
      runStep = async (agentPrompt, prompt, useSearch = false) => {
        let augmentedPrompt = prompt;
        if (useSearch) {
          augmentedPrompt = `[Web Search Simulation Enabled]\n${prompt}`;
        }
        return await generateHFContentWithRetry(hfModel, augmentedPrompt, agentPrompt, hfToken);
      };
    } else {
      // Gemini Provider
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const modelName = settings.geminiModel || 'gemini-2.0-flash';
      console.log(`[Simulation][${runId}] Initializing Gemini models with: ${modelName}`);

      const standardModel = genAI.getGenerativeModel({ model: modelName });
      
      // Enable Google Search Grounding for the search model
      const searchModel = genAI.getGenerativeModel({
        model: modelName,
        tools: [{ googleSearch: {} }]
      });
      
      runStep = async (agentPrompt, prompt, useSearch = false) => {
        const model = useSearch ? searchModel : standardModel;
        const result = await generateContentWithRetry(model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: agentPrompt
        });
        return result.response.text();
      };
    }

    const run = db.getRun(runId);
    const workflow = run.workflow || 'compiler';

    if (workflow === 'validator') {
      // Find validator agents
      const scout = agents.find(a => a.id === 'valerie') || agents.find(a => a.role?.toLowerCase().includes('scout')) || agents[0];
      const tech = agents.find(a => a.id === 'pax') || agents.find(a => a.role?.toLowerCase().includes('architect')) || agents[1];
      const risk = agents.find(a => a.id === 'damien') || agents.find(a => a.role?.toLowerCase().includes('risk')) || agents[2];
      const partner = agents.find(a => a.id === 'vera') || agents.find(a => a.role?.toLowerCase().includes('partner')) || agents[3];

      // --- STEP 1: Valerie (Market Scout) ---
      console.log(`[Simulation][${runId}] Step 1: Researching market with Valerie...`);
      const marketPrompt = `Conduct comprehensive market research on this startup idea: "${topic}". Search for existing competitors, market size, trends, similar failures, and target customer demographics. Provide a detailed summary of your findings.`;
      const marketText = await runStep(scout.prompt, marketPrompt, true);
      db.addRunMessage(runId, scout.name, scout.role, marketText);

      // --- STEP 2: Pax (Tech Architect) ---
      console.log(`[Simulation][${runId}] Step 2: Evaluating tech feasibility with Pax...`);
      const techPrompt = `Evaluate the technical feasibility of this startup idea: "${topic}". Here is the market research data: \n\n${marketText}\n\nDraft a technical assessment detailing the complexity, suggested tech stack (frontend, backend, database, APIs), potential technical bottlenecks, and integration requirements.`;
      const techText = await runStep(tech.prompt, techPrompt, false);
      db.addRunMessage(runId, tech.name, tech.role, techText);

      // --- STEP 3: Damien (Risk Analyst) ---
      console.log(`[Simulation][${runId}] Step 3: Playing Devil's Advocate with Damien...`);
      const riskPrompt = `Critique this startup idea brutally: "${topic}". Here is the market research:\n${marketText}\n\nHere is the technical feasibility assessment:\n${techText}\n\nPoint out all potential flaws, operational/regulatory risks, scalability issues, business model weak spots, customer adoption challenges, and structural reasons this business might fail. Do not hold back.`;
      const riskText = await runStep(risk.prompt, riskPrompt, false);
      db.addRunMessage(runId, risk.name, risk.role, riskText);

      // --- STEP 4: Vera (Investment Partner) ---
      console.log(`[Simulation][${runId}] Step 4: Compiling final report with Vera...`);
      const finalPrompt = `Startup Idea: "${topic}"\n\nMarket Research:\n${marketText}\n\nTechnical Feasibility:\n${techText}\n\nRisk Assessment:\n${riskText}\n\nSynthesize all these analysis phases into a final Startup Validation Report. Structure this report with an Executive Summary, a SWOT Matrix, a Technical Feasibility score, a Devil's Advocate Risk Score, and a final "Go/No-Go" investment recommendation with a rating out of 10.`;
      const finalReport = await runStep(partner.prompt, finalPrompt, false);
      db.addRunMessage(runId, `${partner.name} (Final)`, partner.role, finalReport);

      // --- FINALIZE RUN ---
      console.log(`[Simulation][${runId}] Run completed successfully!`);
      db.updateRun(runId, {
        status: 'completed',
        finalReport
      });
    } else {
      // Find compiler agents by ID or index
      const researcher = agents.find(a => a.id === 'researcher') || agents[0];
      const synthesizer = agents.find(a => a.id === 'synthesizer') || agents[1];
      const writer = agents.find(a => a.id === 'writer') || agents[2];
      const critic = agents.find(a => a.id === 'critic') || agents[3];

      // --- STEP 1: Dr. Atlas (Researcher) ---
      console.log(`[Simulation][${runId}] Step 1: Researching topic with Dr. Atlas...`);
      const researchPrompt = `Conduct a detailed web search on the following topic and compile a comprehensive list of factual findings, statistics, events, and relevant references. Cite web links and dates where available. Topic: ${topic}`;
      
      const researchText = await runStep(researcher.prompt, researchPrompt, true);
      db.addRunMessage(runId, researcher.name, researcher.role, researchText);

      // --- STEP 2: Skye (Outline Architect) ---
      console.log(`[Simulation][${runId}] Step 2: Structuring outline with Skye...`);
      const outlinePrompt = `Here is the web research data collected: \n\n${researchText}\n\nBased on this research data, construct a detailed chapter outline in Markdown format. Specify what sub-points, headers, and statistics each chapter must cover.`;
      
      const outlineText = await runStep(synthesizer.prompt, outlinePrompt, false);
      db.addRunMessage(runId, synthesizer.name, synthesizer.role, outlineText);

      // --- STEP 3: Sterling (Lead Writer) ---
      console.log(`[Simulation][${runId}] Step 3: Drafting initial report with Sterling...`);
      const draftPrompt = `Outline:\n${outlineText}\n\nFacts:\n${researchText}\n\nExpand this outline into a full, detailed report draft. Write out all sections completely in Markdown. Avoid summaries or placeholders—write out the complete text.`;
      
      const draftText = await runStep(writer.prompt, draftPrompt, false);
      db.addRunMessage(runId, writer.name, writer.role, draftText);

      // --- STEP 4: Nova (Quality Inspector) ---
      console.log(`[Simulation][${runId}] Step 4: Critiquing draft with Nova...`);
      const critiquePrompt = `Here is the draft report to inspect: \n\n${draftText}\n\nReview this draft and provide detailed, constructive feedback on its tone, style, factual gaps, and readability. Suggest specific improvements.`;
      
      const critiqueText = await runStep(critic.prompt, critiquePrompt, false);
      db.addRunMessage(runId, critic.name, critic.role, critiqueText);

      // --- STEP 5: Sterling (Final Editor) ---
      console.log(`[Simulation][${runId}] Step 5: Final polish with Sterling...`);
      const finalPrompt = `Draft:\n${draftText}\n\nFeedback:\n${critiqueText}\n\nRefine and polish the draft based on the quality inspector's feedback. Output the final, complete, high-quality report in Markdown.`;
      
      const finalReport = await runStep(writer.prompt, finalPrompt, false);
      db.addRunMessage(runId, `${writer.name} (Final)`, writer.role, finalReport);

      // --- FINALIZE RUN ---
      console.log(`[Simulation][${runId}] Run completed successfully!`);
      db.updateRun(runId, {
        status: 'completed',
        finalReport
      });
    }

  } catch (error) {
    console.error(`[Simulation][${runId}] Run failed with error:`, error);
    const errorDetails = error.cause ? `${error.message} (Cause: ${error.cause.message || error.cause})` : error.message;
    db.updateRun(runId, {
      status: 'failed',
      finalReport: `An error occurred during multi-agent orchestration: ${errorDetails}`
    });
  }
}
