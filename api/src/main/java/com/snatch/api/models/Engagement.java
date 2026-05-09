package com.snatch.api.models;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.FetchType;
import jakarta.persistence.Table;
import lombok.Data;
import java.time.LocalDateTime;
import jakarta.persistence.Column;
import com.fasterxml.jackson.annotation.JsonIgnore;

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
        PENDING, PHASE_1_SEALED, PHASE_2_LIVE, CLOSED, CANCELLED
    }

    @Enumerated(EnumType.STRING)
    private AuctionStatus status = AuctionStatus.PENDING;

    private Double currentLiveRate;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bearer_email")
    private User bearer;

    private LocalDateTime phase1StartTime;
    private LocalDateTime phase1EndTime;
    private LocalDateTime phase2StartTime;
    private String winnerId;
    
    @Column(name = "phase2_timer_duration")
    private Integer phase2TimerDuration;
}