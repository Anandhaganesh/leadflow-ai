# AutoGen.Studio 🚀
### Multi-Agent Collaborative Web Search, Report Compiler & Startup Validator

**AutoGen.Studio** is a premium, modern Web Console that orchestrates teams of specialized AI agents working together to solve complex, multi-step tasks. Powered by **Google Gemini API** and **Hugging Face Serverless Inference API** (running open-source models like Qwen 2.5 72B), the application demonstrates true cooperative agentic AI.

---

## 🌟 Key Features

### 1. Two Specialized Multi-Agent Workflows
Toggle between two entirely different agent teams depending on your goals:

*   **📝 Report Compiler Team**
    *   **Dr. Atlas (Lead Researcher)**: Conducts detailed web searches, scraping facts, statistics, and references.
    *   **Skye (Outline Architect)**: Structures raw research data into a chapter-by-chapter outline.
    *   **Sterling (Lead Writer)**: Expands the outline into a complete, descriptive Markdown report.
    *   **Nova (Quality Inspector)**: Audits the draft and provides critiques.
    *   *Sterling* then performs a final editing pass based on the critique to publish the final draft.

*   **🚀 Startup Validator Team**
    *   **Valerie (Market Scout)**: Researches market competitors, customer demographics, and industry trends.
    *   **Pax (Tech Architect)**: Evaluates build complexity, proposes a modern tech stack, and details scaling blueprints.
    *   **Damien (Devil's Advocate / Risk Analyst)**: Brutally critiques product-market fit, user adoption hurdles, and business flaws.
    *   **Vera (Investment Partner)**: Synthesizes all data into a SWOT matrix, risk rating, and a Go/No-Go investment score.

### 2. Live Collaboration Roadmap
Watch the agents work in real-time. The visual progress tracker lights up steps sequentially, shows agent thinking indicators (`thinking...`), and streams dialogue logs before publishing the final report.

### 3. Dual API Providers
*   **Google Gemini AI**: Supporting `gemini-2.0-flash`, `gemini-1.5-pro`, etc. (with built-in Google Search grounding).
*   **Hugging Face API**: Seamless integration with the unified router to run open-source state-of-the-art models like `Qwen/Qwen2.5-72B-Instruct` or `Llama 3.3` with zero server overhead.

---

## 🛠️ Tech Stack

*   **Frontend**: React (Vite build), Lucide React, Custom CSS (sleek dark mode, glassmorphism, responsive grid layout).
*   **Backend**: Node.js, Express, Custom JSON-based database for persistence.
*   **Orchestrator**: Custom sequential promise-chain state loop managing context passing between agents.

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Anandhaganesh/autogen-studio.git
   cd autogen-studio
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```env
   PORT=5000
   GEMINI_API_KEY=your_gemini_api_key_here
   HF_TOKEN=your_hugging_face_token_here
   ```

4. Run the development server (runs backend and frontend concurrently):
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   ```

---

## 🔒 Configuration Notes

*   When using **Hugging Face**, ensure your user access token has the **"Make calls to Inference Providers"** permission enabled in your [Hugging Face Settings](https://huggingface.co/settings/tokens).
