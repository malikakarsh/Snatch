package com.snatch.api.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "auction_items")
@Data
public class AuctionItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "engagement_id", nullable = false)
    private Engagement engagement;

    @Column(nullable = false)
    private String name;

    // Optional starting price; null/0 means starts at zero.
    @Column(name = "starting_price")
    private Double startingPrice;

    // Optional long-form description, set at creation time and surfaced via
    // the downloadable catalog so bidders can preview what they'll be bidding
    // on. NOT shown live during the auction. Use TEXT (no length cap) — some
    // descriptions can be multiple paragraphs.
    @Column(columnDefinition = "TEXT")
    private String description;

    // Position within the auction list (0-indexed).
    @Column(name = "sequence_order", nullable = false)
    private Integer sequenceOrder;

    public enum ItemStatus {
        PENDING,    // not yet up for auction
        ACTIVE,     // currently being auctioned
        SOLD,       // sold to a winner
        SKIPPED     // no bids received within grace period
    }

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ItemStatus status = ItemStatus.PENDING;

    @Column(name = "winner_id")
    private String winnerId;

    @Column(name = "sold_price")
    private Double soldPrice;
}