package com.snatch.api.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "seats", uniqueConstraints = {
    // One bidder can hold at most one seat per auction
    @UniqueConstraint(name = "uk_seat_engagement_bidder", columnNames = {"engagement_id", "bidder_email"}),
    // Each seat index can be held by at most one bidder per auction
    @UniqueConstraint(name = "uk_seat_engagement_index",  columnNames = {"engagement_id", "seat_index"})
})
@Data
public class Seat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "engagement_id", nullable = false)
    private Engagement engagement;

    @Column(name = "bidder_email", nullable = false)
    private String bidderEmail;

    // Index 0..15 within the 4x4 grid.
    @Column(name = "seat_index", nullable = false)
    private Integer seatIndex;

    @CreationTimestamp
    @Column(name = "claimed_at", updatable = false, nullable = false)
    private LocalDateTime claimedAt;
}