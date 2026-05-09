package com.snatch.api.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "registrations", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"engagement_id", "provider_id"})
})
@Data
public class Registration {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "engagement_id", nullable = false)
    private Engagement engagement;

    @Column(name = "provider_id", nullable = false)
    private String providerId;

    @Column(nullable = false)
    private boolean withdrawn = false;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime registeredAt;
}
