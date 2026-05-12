package com.snatch.api.repositories;

import java.util.Optional;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.Engagement;

import jakarta.persistence.LockModeType;

@Repository
public interface EngagementRepository extends JpaRepository<Engagement, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM Engagement e WHERE e.id = :id")
    Optional<Engagement> findByIdWithPessimisticLock(@Param("id") Long id);

    List<Engagement> findByStatus(Engagement.AuctionStatus status);
    List<Engagement> findAllByOrderByIdDesc();
    List<Engagement> findByStatusOrderByIdDesc(Engagement.AuctionStatus status);

    @Query("SELECT e FROM Engagement e WHERE e.bearer.email = :email ORDER BY e.id DESC")
    List<Engagement> findMyAuctionsAsBearer(@Param("email") String email);

    // A bidder is associated with an engagement if:
    //   (a) they submitted at least one Phase 1 sealed bid (CLOSED DESCENDING auctions), OR
    //   (b) they won at least one item (OPEN auctions — no Phase 1 happens), OR
    //   (c) they registered for a CLOSED ASCENDING auction.
    @Query("SELECT DISTINCT e FROM Engagement e WHERE e.id IN (" +
           "  SELECT s.engagement.id FROM Submission s " +
           "  WHERE s.providerId = :providerId AND s.phase = com.snatch.api.models.Submission.SubmissionPhase.PHASE_1" +
           ") OR e.id IN (" +
           "  SELECT i.engagement.id FROM AuctionItem i WHERE i.winnerId = :providerId" +
           ") OR e.id IN (" +
           "  SELECT r.engagement.id FROM Registration r WHERE r.providerId = :providerId AND r.withdrawn = false" +
           ") ORDER BY e.id DESC")
    List<Engagement> findMyAuctionsAsBidder(@Param("providerId") String providerId);

    // OPEN auctions where the bidder won at least one item — different shape
    // from CLOSED because OPEN auctions never have an engagement-level winnerId.
    @Query("SELECT DISTINCT e FROM Engagement e " +
           "JOIN AuctionItem i ON i.engagement.id = e.id " +
           "WHERE i.winnerId = :providerId " +
           "ORDER BY e.id DESC")
    List<Engagement> findOpenAuctionsWithItemsWonBy(@Param("providerId") String providerId);
}