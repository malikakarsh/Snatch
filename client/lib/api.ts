const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';

export interface Engagement {
  id?: number;
  title: string;
  description: string;
  auctionType: 'DESCENDING' | 'ASCENDING';
  targetRate: number;
  maxStartingRate: number;
  status?: 'PENDING' | 'PHASE_1_SEALED' | 'PHASE_2_LIVE' | 'CLOSED' | 'CANCELLED';
  currentLiveRate?: number;
  phase1StartTime?: string;
  phase1EndTime?: string;
  phase2StartTime?: string;
  winnerId?: string;
}

export interface Submission {
  id?: number;
  engagement?: Engagement;
  providerId: string;
  rate: number;
  phase?: 'PHASE_1' | 'PHASE_2';
  submittedAt?: string;
}

export const engagementAPI = {
  // Create new engagement
  createEngagement: async (engagement: Engagement): Promise<Engagement> => {
    const response = await fetch(`${API_BASE_URL}/engagements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(engagement),
    });

    if (!response.ok) {
      const msg = await response.text();
      throw new Error(msg || 'Failed to create engagement.');
    }

    return response.json();
  },

  // Submit sealed offer
  submitSealedOffer: async (
    engagementId: number,
    providerId: string,
    rate: number
  ): Promise<Submission> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/sealed-offers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId, rate }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to submit sealed offer: ${response.statusText}`);
    }

    return response.json();
  },

  // Transition to live round
  transitionToLiveRound: async (engagementId: number): Promise<Engagement> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/transition`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to transition to live round: ${response.statusText}`);
    }

    return response.json();
  },

  // Submit live offer
  submitLiveOffer: async (
    engagementId: number,
    providerId: string,
    rate: number
  ): Promise<string> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/live-offers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId, rate }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to submit live offer: ${response.statusText}`);
    }

    return response.text();
  },

  // Quit auction
  quitAuction: async (
    engagementId: number,
    providerId: string
  ): Promise<string> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/quit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to quit auction: ${response.statusText}`);
    }

    return response.text();
  },

  // Get Bidder Status
  getMyStatus: async (
    engagementId: number,
    providerId: string
  ): Promise<{ lastBidRate: number | null; signal: string; isRegistered: boolean; isWithdrawn: boolean; isEligibleForPhase2: boolean }> => {
    const response = await fetch(
      `${API_BASE_URL}/engagements/${engagementId}/my-status?providerId=${encodeURIComponent(providerId)}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch status`);
    }

    return response.json();
  },

  registerForAuction: async (engagementId: number, providerId: string): Promise<string> => {
    const response = await fetch(`${API_BASE_URL}/engagements/${engagementId}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to register`);
    }

    return response.text();
  },
};
