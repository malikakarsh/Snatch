package com.snatch.api.repositories;

import com.snatch.api.models.AuctionItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AuctionItemRepository extends JpaRepository<AuctionItem, Long> {
    List<AuctionItem> findByEngagementIdOrderBySequenceOrderAsc(Long engagementId);
    long countByEngagementId(Long engagementId);

    // Items won by a specific bidder in a specific engagement.
    List<AuctionItem> findByEngagementIdAndWinnerIdOrderBySequenceOrderAsc(Long engagementId, String winnerId);

    // Across all engagements: every item this bidder has ever won.
    List<AuctionItem> findByWinnerIdOrderByIdDesc(String winnerId);
}