# Scaffold Agent Homepage

A configurable Next.js scaffold for building AI Agent homepages with a built-in chat interface powered by [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat).

## Configuration

> Update the value in thie part will change the value on the app automatically😎.
> 
> 修改此处的 Value，程序中对应的值会自动更新。

* **homepageName**
  * **description:** Display name shown in the header, footer, and page title
  * **value:** `"LeanCoder"`

* **fullName**
  * **description:** Full agent name shown on the profile card
  * **value:** `"轻量程序生成大师LeanCoder"`

* **twitterUrl**
  * **description:** Twitter/X profile URL shown in the footer
  * **value:** `"https://x.com/0xleeduckgo"`

* **twitterNicename**
  * **description:** Display name for the Twitter link in the footer
  * **value:** `"leeduckgo@NonceGeek"`

* **descriptionMarkdown**
  * **description:** Agent description in markdown (supports bold, links, newlines)
  * **value:** `"Generate a micro pragram as a real human programmer, \n像人类工程师一样帮你生成轻量级的程序。"`

* **agentAddress**
  * **description:** On-chain address displayed on the profile card.
  * **value:** `"0x5cf8ed0e6b49da5d87ba69c4e50aa9b78c57bf0dd446f9889c8f8b5e57b0f336"`

* **freeTierDescription**
  * **description:** Description text for the free tier card
  * **value:** `"Chat with the LeanCoder for free. Generate the micro program automatically!\n与LeanCoder免费聊天，自动生成微程序！"`

* **freeTierLink**
  * **description:** Link target for the free tier button
  * **value:** `"/chat"`

* **agentTags**
  * **description:** Array of tag labels shown on the profile card
  * **value:** `["Coder", "Web3er"]`

* **premiumTierDescription**
  * **description:** Description for the premium tier card (supports markdown with images and links)
  * **value:** ` "For Example, you could submit the prompt like that:\n 例如，你可以像这样提交你的 Prompt：\n「Generate an online letter for my fans and record the number of visits, and deploy it to my domain: https://letter.leeduckgo.com.」\n💡微信扫码进一步沟通：\n![my_qr_code](https://dimsum-utils.oss-cn-guangzhou.aliyuncs.com/leeduckgo/qr_code2.png)\n或者给我发送私信：[https://x.com/0xleeduckgo](https://x.com/0xleeduckgo)"`

* **chatbotDescription**
  * **description:** Subtitle text on the `/chat` page
  * **value:** `"Talk to LeanCoder if you have any questions about programming."`

* **chatbotIntroMessage**
  * **description:** Initial greeting message in the chat window
  * **value:** `"你好！我是 LeanCoder轻量级程序编写大师~ 你有什么问题都可以问我哦~"`

* **chatApiUrl**
  * **description:** Backend API endpoint for the chat
  * **value:** `"https://api.scaffold-agent-homepage.leeduckgo.com/api/chat"`


## Quick Start

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm

### Installation

```bash
git clone <your-repo-url>
cd main
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
npm run start
```

## Project Structure

```
main/
├── app/
│   ├── page.tsx              # Homepage
│   ├── chat/page.tsx         # Chat page (Deep Chat UI)
│   ├── layout.tsx            # Root layout with providers
│   └── globals.css           # Global styles
├── components/
│   ├── ui/                   # shadcn/ui base components
│   ├── header.tsx            # Site header with navigation
│   ├── agent-profile-card.tsx # Agent profile card component
│   ├── free-tier-card.tsx    # Free tier feature card
│   ├── premium-tier-card.tsx # Premium tier feature card
│   ├── theme-provider.tsx    # Theme provider (light/dark)
│   └── theme-toggle.tsx      # Theme toggle button
├── hooks/                    # Custom React hooks
├── lib/                      # Utility functions
├── public/                   # Static assets (avatar, icons)
└── package.json              # Dependencies and config
```

## Available Scripts

```bash
npm run dev            # Start dev server with Turbopack
npm run build          # Production build
npm run start          # Start production server
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Prettier
npm run format:check   # Check formatting
```

## Tech Stack

- [Next.js](https://nextjs.org/) — React framework
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS
- [shadcn/ui](https://ui.shadcn.com/) — UI component library
- [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat) — AI chat component
- [next-themes](https://github.com/pacocoursey/next-themes) — Dark/light mode

## License

MIT
