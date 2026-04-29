package com.snatch.api.models;

import java.time.LocalDateTime;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Data;

@Entity
@Table(name = "submissions")
@Data
public class Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "engagement_id", nullable = false)
    private Engagement engagement;

    @Column(nullable = false)
    private String providerId;

    @Column(nullable = false)
    private Double rate;

    public enum SubmissionPhase {
        PHASE_1, PHASE_2
    }

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SubmissionPhase phase;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime submittedAt;
}