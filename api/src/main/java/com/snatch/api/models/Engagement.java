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
import jakarta.persistence.Transient;
import lombok.Data;
import java.time.LocalDateTime;
import jakarta.persistence.Column;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonProperty.Access;

@Entity
@Table(name = "engagements")
@Data 
public class Engagement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;
    private String description;
    
    private String auctionType;

    @Column(name = "auction_format")
    private String auctionFormat;

    private Double targetRate;
    private Double maxStartingRate;

    public enum AuctionStatus {
        PENDING, PHASE_1_SEALED, PHASE_2_LIVE, CLOSED, CANCELLED
    }

    @Enumerated(EnumType.STRING)
    private AuctionStatus status = AuctionStatus.PENDING;

    // For CANCELLED auctions, a machine-readable reason (e.g. NO_PARTICIPANTS,
    // STOPPED_BY_AUCTIONEER). Free-form string so we can add cases without
    // migrations.
    @Column(name = "cancel_reason")
    private String cancelReason;

    private Double currentLiveRate;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bearer_email")
    private User bearer;

    @Column(name = "auctioneer_name")
    private String auctioneerName;

    @Transient
    @JsonProperty(value = "bearerEmailInput", access = Access.WRITE_ONLY)
    private String bearerEmailInput;

    private LocalDateTime phase1StartTime;
    private LocalDateTime phase1EndTime;
    private LocalDateTime phase2StartTime;

    // OPEN auction scheduled start. If set, the AuctionScheduler auto-starts
    // the auction when this time passes (provided at least one seat is
    // claimed). If null, the bearer must manually start via /open/start.
    @Column(name = "open_start_time")
    private LocalDateTime openStartTime;

    // OPEN auction scheduled end. Informational only — surfaced in the UI as
    // a hint to bidders. Does NOT trigger any backend action.
    @Column(name = "open_end_time")
    private LocalDateTime openEndTime;

    // OPEN auction grace seconds — how long the first-bid window lasts for
    // each item before it's skipped. Bearer-configurable in the form. Null
    // falls back to a default in the service.
    @Column(name = "grace_seconds")
    private Integer graceSeconds;

    private String winnerId;
    
    @Column(name = "phase2_timer_duration")
    private Integer phase2TimerDuration;

    @Transient
    @JsonProperty("bearerEmail")
    public String getBearerEmail() {
        return bearer != null ? bearer.getEmail() : null;
    }
}