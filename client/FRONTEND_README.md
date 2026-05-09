# Snatch - Auction Platform Frontend

A modern, responsive Next.js frontend for the Snatch auction platform, featuring a dark theme with orange accents and full integration with the backend API.

## Features

- **🎯 Dashboard**: Browse and manage active auctions
- **📝 Auction Creation**: Create new descending (Dutch) or ascending (English) auctions
- **📧 Sealed Bidding**: Submit confidential bids in phase 1
- **🔴 Live Bidding**: Participate in real-time auctions in phase 2
- **🎨 Dark Theme**: Beautiful dark interface with orange accents
- **📱 Responsive Design**: Works seamlessly on all device sizes
- **⚡ Real-time Updates**: Built-in support for live auction dynamics

## Tech Stack

- **Framework**: Next.js 16.2.4
- **UI Library**: React 19.2.4
- **Styling**: Tailwind CSS 4
- **Language**: TypeScript
- **State Management**: React Hooks

## Getting Started

### Prerequisites

- Node.js 18+ or npm 9+
- The Snatch API running on `http://localhost:8080`

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure the API endpoint in `.env.local`:
```bash
NEXT_PUBLIC_API_URL=http://localhost:8080/api
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
app/
├── components/
│   ├── Header.tsx          # Navigation header
│   ├── AuctionForm.tsx     # Create new auction form
│   ├── AuctionCard.tsx     # Auction display card
│   └── OfferForm.tsx       # Sealed & live offer submission
├── layout.tsx              # Root layout with header
├── page.tsx                # Main dashboard page
└── globals.css             # Global styles & Tailwind

lib/
└── api.ts                  # API service layer

.env.local                  # Environment configuration
```

## API Integration

The frontend integrates with these backend endpoints:

### Engagement Management
- **POST** `/api/engagements` - Create new auction
- **POST** `/api/engagements/{id}/transition` - Move to live round

### Bidding
- **POST** `/api/engagements/{id}/sealed-offers` - Submit sealed bid
- **POST** `/api/engagements/{id}/live-offers` - Submit live bid

## Components

### AuctionForm
Creates new auctions with:
- Title and description
- Auction type (DESCENDING/ASCENDING)
- Target rate and maximum starting rate

### AuctionCard
Displays auction details with:
- Status badge (PENDING, PHASE_1_SEALED, PHASE_2_LIVE, CLOSED)
- Current rate tracking
- Expandable details section

### OfferForm
Manages bidding with:
- Phase-aware form switching
- Provider ID and rate input
- Real-time validation and feedback

## Styling

The theme uses:
- **Background**: Dark gray (#111827, #0f172a)
- **Primary**: Orange (#f97316)
- **Secondary**: Gray tones for contrast
- **Accents**: Orange gradients for highlights

Responsive breakpoints:
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

## Development

### Build Production
```bash
npm run build
npm start
```

### Linting
```bash
npm run lint
```

## Best Practices Implemented

✅ **Performance**
- Client-side state management
- Optimized re-renders with hooks
- Lazy component loading

✅ **Accessibility**
- Semantic HTML elements
- Proper ARIA labels
- Keyboard navigation support

✅ **Responsive Design**
- Mobile-first approach
- Flexible grid layouts
- Touch-friendly buttons

✅ **Code Quality**
- TypeScript for type safety
- Modular component structure
- Error handling and validation
- Clear API abstraction layer

✅ **User Experience**
- Loading states
- Error messages
- Success feedback
- Empty states
- Intuitive navigation

## Troubleshooting

### API Connection Issues
- Ensure the Spring Boot backend is running on port 8080
- Check `.env.local` for correct API URL
- Browser console will show network errors

### Styling Not Applying
- Verify Tailwind CSS is properly imported in `globals.css`
- Clear `.next` directory: `rm -rf .next`
- Restart dev server

### Build Errors
- Clear node_modules: `rm -rf node_modules`
- Reinstall: `npm install`
- Check TypeScript: `npx tsc --noEmit`

## License

Built for the Snatch Auction Platform
