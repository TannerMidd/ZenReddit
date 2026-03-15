# ZenReddit 🌿

![Version](https://img.shields.io/badge/version-0.9.0-blue)

> **⚠️ AI-GENERATED PROJECT DISCLAIMER**
> 
> This application was **primarily architected and coded by Artificial Intelligence** (specifically Google's Gemini models). It serves as a **proof of concept** to test the limits of current AI software engineering capabilities. While fully functional, it should be viewed as an experimental showcase of AI-assisted development.

ZenReddit is a peaceful, AI-powered Reddit client designed to filter out rage-bait, divisive politics, and high-stress content. It uses the OpenRouter API to analyze posts in real-time, assigning a "Zen Score" to content and shielding you from negativity.

![ZenReddit App](https://via.placeholder.com/800x450?text=ZenReddit+Preview)

## ✨ Features

*   **AI Content Filtering**: Automatically detects and hides "rage bait," toxic arguments, and stress-inducing news.
*   **Zen Score**: Every post is graded from 0-100 based on how peaceful, constructive, or wholesome it is.
*   **Smart Feed**:
    *   **Popular & Peaceful**: A curated version of r/all.
    *   **Subreddit Search**: Browse specific communities with AI filtering applied.
*   **Zen Mode Customization**: Adjust the strictness of the AI filter (Relaxed, Balanced, Strict).
*   **Bring Your Own AI**: Powered exclusively by OpenRouter, allowing you to choose from various models (Gemini, DeepSeek, Llama, etc.).
*   **Visualizer**: Beautiful scanning animations while the AI processes your feed.

## 🚀 Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js** (v18 or higher)
*   **npm** (Node Package Manager)

You will need an API Key for the AI analysis:
*   **Required**: [OpenRouter API Key](https://openrouter.ai/).

## 🛠️ Installation & Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/zen-reddit.git
    cd zen-reddit
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Run the Application**
    Start the local development server:

    ```bash
    npm start
    # OR if using Vite
    npm run dev
    ```

4.  **Open in Browser**
    Navigate to `http://localhost:3000` (or the port shown in your terminal).

5.  **Configure API Key**
    Once the app is running, click the **Settings (Gear Icon)** in the top right corner and enter your **OpenRouter API Key**. The key is stored locally in your browser.

## 🐳 Docker Deployment

You can deploy ZenReddit easily using Docker.

1.  **Prerequisites**
    Ensure you have Docker and Docker Compose installed on your machine.

2.  **Run with Docker Compose**

    ```bash
    docker-compose up --build -d
    ```

3.  **Access the App**
    The application will be available at `http://localhost`. Don't forget to enter your OpenRouter Key in the settings menu.

## 📖 Usage Guide

### Navigation
*   **All Popular**: The default view. Shows trending content from Reddit, filtered for positivity.
*   **Home**: Shows content from your followed subreddits.
*   **Sidebar**: Search for subreddits (e.g., "CozyPlaces", "Woodworking") and click the `+` to follow them.

### Adjusting AI Settings
1.  Click the **Settings (Gear Icon)** in the top right corner.
2.  **Filter Strictness**: Use the slider to determine how aggressive the filtering is.
    *   *< 30*: Relaxed (Allows mild controversy).
    *   *50*: Balanced (Standard filtering).
    *   *> 70*: Strict (Wholesome content only).
3.  **OpenRouter Config**: Enter your API Key and select your preferred model.

### Video Support
Video posts are automatically detected.
*   **Thumbnails**: Video posts display a "Play" icon overlay on the thumbnail.
*   **Playback**: Click a post to open the Detail View, where the video will be embedded (using Reddit's secure media fallback).

## 🔧 Troubleshooting

*   **"Rate limited by Reddit"**: Reddit has strict API limits for unauthenticated requests. If you refresh too often, wait a minute and try again.
*   **Images/Videos not loading**: The app uses a CORS proxy (`corsproxy.io`) to fetch data from Reddit, as Reddit does not support client-side CORS natively. If the proxy is down, content may fail to load.
*   **AI Analysis Stuck**: If the "Analyzing..." visualizer runs forever, check that your OpenRouter Key is valid and has credits.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open-source.