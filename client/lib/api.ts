const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';

export interface Engagement {
  id?: number;
  title: string;
  description: string;
  auctionType: 'DESCENDING' | 'ASCENDING';
  auctionFormat?: 'CLOSED' | 'OPEN';
  targetRate: number;
  maxStartingRate: number;
  status?: 'PENDING' | 'PHASE_1_SEALED' | 'PHASE_2_LIVE' | 'CLOSED' | 'CANCELLED';
  currentLiveRate?: number;
  phase1StartTime?: string;
  phase1EndTime?: string;
  phase2StartTime?: string;
  phase2TimerDuration?: number;
  winnerId?: string;
  auctioneerName?: string | null;
  bearerEmail?: string;
  bearerEmailInput?: string;
  openStartTime?: string;
  openEndTime?: string;
  graceSeconds?: number;
  cancelReason?: string;
}

export interface Submission {
  id?: number;
  engagement?: Engagement;
  providerId: string;
  rate: number;
  phase?: 'PHASE_1' | 'PHASE_2';
  submittedAt?: string;
}

export interface AuctionItem {
  id: number;
  name: string;
  description: string | null;
  startingPrice: number | null;
  sequenceOrder: number;
  status: 'PENDING' | 'ACTIVE' | 'SOLD' | 'SKIPPED';
  winnerId: string | null;
  soldPrice: number | null;
}

export const engagementAPI = {
  createEngagement: async (engagement: Engagement): Promise<Engagement> => {
    const response = await fetch(`${API_BASE_URL}/engagements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(engagement),
    });
    if (!response.ok) {
      const msg = await response.text();
      throw new Error(msg || 'Failed to create engagement.');
    }
    return response.json();
  },

  getMyAuctions: async (email: string, role: 'BEARER' | 'BIDDER'): Promise<Engagement[]> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/my?email=${encodeURIComponent(email)}&role=${role}`
    );
    if (!response.ok) throw new Error(`Failed to fetch my auctions: ${response.statusText}`);
    return response.json();
  },

  submitSealedOffer: async (engagementId: number, providerId: string, rate: number): Promise<Submission> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/sealed-offers`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, rate }) }
    );
    if (!response.ok) throw new Error(`Failed to submit sealed offer: ${response.statusText}`);
    return response.json();
  },

  transitionToLiveRound: async (engagementId: number): Promise<Engagement> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/transition`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    if (!response.ok) throw new Error(`Failed to transition to live round: ${response.statusText}`);
    return response.json();
  },

  submitLiveOffer: async (engagementId: number, providerId: string, rate: number): Promise<string> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/live-offers`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, rate }) }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to submit live offer: ${response.statusText}`);
    }
    return response.text();
  },

  quitAuction: async (engagementId: number, providerId: string): Promise<string> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/quit`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }) }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to quit auction: ${response.statusText}`);
    }
    return response.text();
  },

  getMyStatus: async (engagementId: number, providerId: string): Promise<{ lastBidRate: number | null; signal: string; isRegistered: boolean; isWithdrawn: boolean; isEligibleForPhase2: boolean }> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/my-status?providerId=${encodeURIComponent(providerId)}`
    );
    if (!response.ok) throw new Error(`Failed to fetch status`);
    return response.json();
  },

  registerForAuction: async (engagementId: number, providerId: string): Promise<string> => {
    const response = await fetch(`${API_BASE_URL}/engagements/${engagementId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to register`);
    }
    return response.text();
  },
};

export const favoritesAPI = {
  add: async (engagementId: number, userEmail: string): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail }),
    });
    if (!res.ok) throw new Error(`Failed to favorite: ${res.statusText}`);
  },
  remove: async (engagementId: number, userEmail: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/favorite?userEmail=${encodeURIComponent(userEmail)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error(`Failed to unfavorite: ${res.statusText}`);
  },
  list: async (email: string): Promise<Engagement[]> => {
    const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(email)}/favorites`);
    if (!res.ok) throw new Error(`Failed to load favorites: ${res.statusText}`);
    return res.json();
  },
};

export const getAuctioneerDisplayName = (engagement: Engagement): string => {
  if (engagement.auctioneerName && engagement.auctioneerName.trim()) {
    return engagement.auctioneerName.trim();
  }
  if (engagement.bearerEmail) return engagement.bearerEmail.split('@')[0];
  return 'Unknown';
};

export const openAuctionAPI = {
  uploadItems: async (engagementId: number, text: string): Promise<{ count: number; items: AuctionItem[] }> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Failed to upload items');
    }
    return res.json();
  },
  listItems: async (engagementId: number): Promise<AuctionItem[]> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/items`);
    if (!res.ok) throw new Error('Failed to load items');
    return res.json();
  },
  // Items this specific bidder won — used after the auction closes.
  listWon: async (engagementId: number, providerId: string): Promise<AuctionItem[]> => {
    const res = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/open/won?providerId=${encodeURIComponent(providerId)}`
    );
    if (!res.ok) throw new Error('Failed to load won items');
    return res.json();
  },
  claimSeat: async (engagementId: number, bidderEmail: string, seatIndex: number): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/seats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidderEmail, seatIndex }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to claim seat');
    }
  },
  listSeats: async (engagementId: number): Promise<{ seatIndex: number; bidderEmail: string }[]> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/seats`);
    if (!res.ok) throw new Error('Failed to load seats');
    return res.json();
  },
  start: async (engagementId: number): Promise<Engagement> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/start`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to start auction');
    }
    return res.json();
  },
  // Emergency stop. Bearer-only in practice.
  stop: async (engagementId: number): Promise<Engagement> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/stop`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to stop auction');
    }
    return res.json();
  },
  // Bidder passes on the current item only — seat preserved.
  pass: async (engagementId: number, bidderEmail: string): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidderEmail }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to pass on item');
    }
  },
  // Bidder leaves the auction entirely.
  leave: async (engagementId: number, bidderEmail: string): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidderEmail }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to leave auction');
    }
  },
  // Triggers a browser download of the plain-text catalog. We use a hidden
  // anchor instead of opening a new tab because Spring's response sets a
  // Content-Disposition: attachment header which the browser will respect.
  downloadCatalog: async (engagementId: number): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/engagements/${engagementId}/open/catalog`);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || 'Failed to download catalog');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snatch-catalog-${engagementId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};