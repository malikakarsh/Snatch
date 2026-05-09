import { Engagement } from './api';

export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export const formatDate = (date: string | Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
};

export const getStatusLabel = (status?: string): string => {
  switch (status) {
    case 'PENDING':
      return 'Pending Start';
    case 'PHASE_1_SEALED':
      return 'Sealed Bidding';
    case 'PHASE_2_LIVE':
      return 'Live Auction';
    case 'CLOSED':
      return 'Closed';
    default:
      return 'Unknown';
  }
};

export const getAuctionTypeLabel = (type: string): string => {
  return type === 'DESCENDING' ? 'Dutch Auction' : 'English Auction';
};

export const validateRate = (rate: number, currentRate?: number, auctionType?: string): boolean => {
  if (rate <= 0) return false;
  if (auctionType === 'DESCENDING' && currentRate !== undefined) {
    return rate < currentRate;
  }
  return true;
};

export const getAuctionProgress = (engagement: Engagement): number => {
  if (!engagement.currentLiveRate || !engagement.targetRate) return 0;
  const progress = ((engagement.targetRate - engagement.currentLiveRate) /
    (engagement.targetRate - engagement.maxStartingRate)) * 100;
  return Math.min(100, Math.max(0, progress));
};
