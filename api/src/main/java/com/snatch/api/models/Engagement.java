package com.snatch.api.models;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

@Entity
@Table(name = "engagements")
@Data 
public class Engagement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;
    private String description;
    
    // "DESCENDING" or "ASCENDING"
    private String auctionType; 

    private Double targetRate;
    private Double maxStartingRate;

    public enum AuctionStatus {
        PENDING, PHASE_1_SEALED, PHASE_2_LIVE, CLOSED
    }

    @Enumerated(EnumType.STRING)
    private AuctionStatus status = AuctionStatus.PENDING;

    private Double currentLiveRate;
}