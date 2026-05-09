# Frontend Architecture & Integration Guide

## Overview

The Snatch frontend is a modern React/Next.js application built with TypeScript and Tailwind CSS. It provides a responsive, dark-themed interface for managing auctions with real-time bidding capabilities.

## Key Design Decisions

### 1. **Component Structure**
- **Page Components**: Main pages (dashboard)
- **Feature Components**: Reusable UI components (forms, cards)
- **Layout Components**: Persistent UI (header, footer)

### 2. **API Layer Abstraction**
All backend communication happens through `lib/api.ts`:
```typescript
// Centralized API definitions
- engagementAPI.createEngagement()
- engagementAPI.submitSealedOffer()
- engagementAPI.transitionToLiveRound()
- engagementAPI.submitLiveOffer()
```

Benefits:
- Single source of truth for API calls
- Easy to modify endpoints
- Built-in error handling
- Type-safe interfaces

### 3. **State Management**
Uses React Hooks for local component state:
- `useState` for component-level state
- `useEffect` for side effects
- Custom hooks for reusable logic

Why not Redux/Context?
- Application complexity is moderate
- State is mostly component-scoped
- Simple to understand and maintain

### 4. **Styling Strategy**
- **Tailwind CSS**: Utility-first CSS framework
- **Dark Theme**: `gray-900` and `gray-800` backgrounds
- **Orange Accents**: `orange-500` and `orange-600` for highlights
- **Responsive**: Mobile-first, desktop-enhanced

### 5. **Error Handling**
Each API call includes:
- Try-catch blocks
- User-friendly error messages
- Error state display
- Recovery mechanisms

## File Organization

```
app/
├── components/
│   ├── Header.tsx              # Navigation (persistent)
│   ├── AuctionForm.tsx         # Create auction form
│   ├── AuctionCard.tsx         # Display auction
│   └── OfferForm.tsx           # Bid submission
├── layout.tsx                   # Root layout wrapper
└── page.tsx                     # Dashboard/home page

lib/
├── api.ts                       # API service layer
├── hooks.ts                     # Custom React hooks
├── utils.ts                     # Utility functions
└── types.ts                     # Shared TypeScript types

styles/
└── globals.css                  # Global styles & Tailwind
```

## Component Data Flow

```
page.tsx (Dashboard)
│
├─▶ AuctionForm
│   └─▶ engagementAPI.createEngagement()
│       └─▶ Update engagements state
│
├─▶ AuctionCard (maps over engagements)
│   │
│   ├─▶ Display engagement details
│   │
│   └─▶ OfferForm
│       ├─▶ engagementAPI.submitSealedOffer()
│       ├─▶ engagementAPI.transitionToLiveRound()
│       └─▶ engagementAPI.submitLiveOffer()
```

## API Integration Flow

### Creating an Auction

```
User Input (AuctionForm)
    ↓
Form Validation
    ↓
engagementAPI.createEngagement()
    ↓
POST /api/engagements
    ↓
Backend Processing
    ↓
Response: Engagement object
    ↓
Update Frontend State
    ↓
Navigate to Dashboard
    ↓
Display in AuctionCard
```

### Submitting a Bid

```
User Input (OfferForm)
    ↓
Rate Validation
    ↓
engagementAPI.submitSealedOffer() OR submitLiveOffer()
    ↓
POST /api/engagements/{id}/[sealed-offers|live-offers]
    ↓
Backend Processing
    ↓
Success/Error Response
    ↓
Show User Feedback
    ↓
Refresh Auction State
```

## TypeScript Interfaces

### Core Models

```typescript
interface Engagement {
  id?: number;
  title: string;
  description: string;
  auctionType: 'DESCENDING' | 'ASCENDING';
  targetRate: number;
  maxStartingRate: number;
  status?: 'PENDING' | 'PHASE_1_SEALED' | 'PHASE_2_LIVE' | 'CLOSED';
  currentLiveRate?: number;
}

interface Submission {
  id?: number;
  engagement?: Engagement;
  providerId: string;
  rate: number;
  phase?: 'PHASE_1' | 'PHASE_2';
  submittedAt?: string;
}
```

## Styling Conventions

### Color Scheme
```css
/* Backgrounds */
--bg-primary: #111827 (gray-900)
--bg-secondary: #1f2937 (gray-800)
--bg-tertiary: #374151 (gray-700)

/* Accents */
--accent-primary: #f97316 (orange-500)
--accent-secondary: #ea580c (orange-600)

/* Text */
--text-primary: #f3f4f6 (gray-100)
--text-secondary: #d1d5db (gray-300)
--text-tertiary: #9ca3af (gray-400)
```

### Component Classes
```css
.card-gradient      /* Card styling with gradient */
.btn-primary        /* Primary action buttons */
.btn-secondary      /* Secondary action buttons */
.input-field        /* Form inputs */
.badge-orange       /* Orange status badges */
.badge-success      /* Success state badge */
.badge-danger       /* Error state badge */
```

## Best Practices Implemented

### 1. **Performance**
- Minimal re-renders with proper dependency arrays
- No unnecessary state updates
- Efficient array operations

### 2. **Accessibility**
- Semantic HTML elements
- Proper form labels
- Keyboard-navigable interface
- Color contrast compliance

### 3. **User Experience**
- Loading states
- Error boundaries
- Success confirmations
- Empty states
- Intuitive navigation

### 4. **Code Quality**
- TypeScript for type safety
- Modular, reusable components
- Clear separation of concerns
- Documented code

### 5. **Maintainability**
- Consistent naming conventions
- Single responsibility principle
- DRY (Don't Repeat Yourself)
- Easy to extend

## Adding New Features

### Example: Add Auction List Endpoint

1. **Update API Service** (`lib/api.ts`):
```typescript
getAuctions: async (): Promise<Engagement[]> => {
  const response = await fetch(`${API_BASE_URL}/engagements`);
  if (!response.ok) throw new Error('Failed to fetch');
  return response.json();
}
```

2. **Create Hook** (`lib/hooks.ts`):
```typescript
export function useAuctions() {
  return useAsync(engagementAPI.getAuctions);
}
```

3. **Use in Component**:
```typescript
const { data: auctions, loading, error } = useAuctions();
```

## Debugging Tips

### Enable Network Logging
```javascript
// Add to app/page.tsx for debugging
console.log('API calls:', {
  baseUrl: process.env.NEXT_PUBLIC_API_URL
});
```

### Check Component State
```typescript
const [state, setState] = useState({...});
useEffect(() => {
  console.log('State updated:', state);
}, [state]);
```

### Browser DevTools
1. **Network Tab**: Monitor API calls
2. **Console**: Check for errors
3. **React DevTools**: Inspect component tree
4. **Application**: Check local storage

## Future Enhancements

- [ ] Real-time updates via WebSocket
- [ ] Auction history and analytics
- [ ] User authentication
- [ ] Advanced filtering and search
- [ ] Mobile app (React Native)
- [ ] Auction notifications
- [ ] Provider profiles
- [ ] Payment integration

## Performance Metrics

Target metrics:
- **First Contentful Paint (FCP)**: < 1.5s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **Cumulative Layout Shift (CLS)**: < 0.1
- **Time to Interactive (TTI)**: < 3.5s

Monitor with: `npm run build && npm start`

## Support & Issues

Common issues and solutions:

1. **CORS errors**: Check backend allows frontend origin
2. **API 404**: Verify backend endpoint URL
3. **TypeScript errors**: Run `npm run lint`
4. **Styling issues**: Clear `.next` directory

---

For questions or improvements, refer to the FRONTEND_README.md or SETUP_AND_RUN.md
