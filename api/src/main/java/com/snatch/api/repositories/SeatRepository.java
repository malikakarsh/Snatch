package com.snatch.api.repositories;

import com.snatch.api.models.Seat;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SeatRepository extends JpaRepository<Seat, Long> {
    List<Seat> findByEngagementIdOrderBySeatIndexAsc(Long engagementId);
    Optional<Seat> findByEngagementIdAndBidderEmail(Long engagementId, String bidderEmail);
    Optional<Seat> findByEngagementIdAndSeatIndex(Long engagementId, Integer seatIndex);
    long countByEngagementId(Long engagementId);
}