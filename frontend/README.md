# Sangria Frontend

Next.js documentation and landing page for the Sangria x402 payment protocol demo.

## Getting Started

### Prerequisites

- Node.js 18+ or compatible version
- npm

### Installation

```bash
cd frontend
npm install
```

### Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
frontend/
  app/
    page.tsx              # Landing page
    layout.tsx            # Root layout with Navigation and Footer
    globals.css           # Global styles and Tailwind config
    docs/
      page.tsx            # Documentation index
      layout.tsx          # Docs-specific layout with prose styling
      getting-started/    # Getting started guide
      x402-protocol/      # x402 protocol deep dive
      variable-pricing/   # Variable pricing documentation
      architecture/       # Project architecture overview
  components/
    Navigation.tsx        # Site navigation header
    Footer.tsx            # Site footer
  public/                 # Static assets
```

## Features

- **Landing Page**: Showcases the x402 protocol with adapted content from the original design
- **Documentation**: Comprehensive guides covering setup, protocol details, and architecture
- **Responsive Design**: Mobile-first design with Tailwind CSS
- **Custom Theme**: Matches the original Sangria brand colors and styling
- **MDX Support**: Ready for markdown-based content expansion

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS with custom configuration
- **Typography**: Inter (sans-serif) and JetBrains Mono (monospace)
- **Icons**: Lucide React
- **Deployment**: Optimized for Vercel

## Deployment

### Deploy to Vercel

The easiest way to deploy is using [Vercel](https://vercel.com):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GTG-Labs/sangria-net)

Or manually:

```bash
npm run build
# Deploy the .next folder and package.json
```

### Environment Variables

No environment variables required for the frontend.

## Customization

### Update Brand Colors

Edit `app/globals.css` to modify the color scheme:

```css
--color-sangria-500: #ec4899; /* Primary brand color */
```

### Add New Documentation Pages

1. Create a new folder in `app/docs/`
2. Add a `page.tsx` file with your content
3. Update the docs index page to link to it

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [x402 Protocol](https://www.x402.org/)
