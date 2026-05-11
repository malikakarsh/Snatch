package com.snatch.api.controllers;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.User;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.repositories.UserRepository;
import com.snatch.api.services.AuctionEngine;

@RestController
@RequestMapping("/api/engagements")
public class EngagementController {

    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;
    private final AuctionEngine openAscendingEngine;  
    private final EngagementRepository engagementRepository;
    private final UserRepository userRepository;

    public EngagementController(
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine,
            @Qualifier("openAscendingEngine") AuctionEngine openAscendingEngine,
            EngagementRepository engagementRepository,
            UserRepository userRepository) {
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
        this.openAscendingEngine = openAscendingEngine;
        this.engagementRepository = engagementRepository;
        this.userRepository = userRepository;
    }

    @PostMapping
    public ResponseEntity<?> createNewEngagement(@RequestBody Engagement newEngagement) {
        try {
            String bearerEmail = newEngagement.getBearerEmailInput();
            if (bearerEmail == null || bearerEmail.isBlank()) {
                return ResponseEntity.badRequest().body("bearerEmailInput is required.");
            }
            Optional<User> bearerOpt = userRepository.findById(bearerEmail);
            if (bearerOpt.isEmpty()) {
                return ResponseEntity.badRequest().body("Bearer not found: " + bearerEmail);
            }
            User bearer = bearerOpt.get();
            if (!"BEARER".equalsIgnoreCase(bearer.getRole())) {
                return ResponseEntity.badRequest().body("Only BEARER accounts can create auctions.");
            }
            newEngagement.setBearer(bearer);

            if (newEngagement.getAuctioneerName() != null) {
                String trimmed = newEngagement.getAuctioneerName().trim();
                newEngagement.setAuctioneerName(trimmed.isEmpty() ? null : trimmed);
            }

            // Normalising auctionFormat. Only ASCENDING auctions can be OPEN.
            String type = newEngagement.getAuctionType();
            String format = newEngagement.getAuctionFormat();
            if (format == null || format.isBlank()) {
                format = "CLOSED";
            }
            format = format.toUpperCase();
            if (!format.equals("CLOSED") && !format.equals("OPEN")) {
                return ResponseEntity.badRequest().body("auctionFormat must be CLOSED or OPEN.");
            }
            if (format.equals("OPEN") && !"ASCENDING".equalsIgnoreCase(type)) {
                return ResponseEntity.badRequest().body("OPEN format is only available for ASCENDING auctions.");
            }
            newEngagement.setAuctionFormat(format);

            Engagement savedEngagement;

            if ("DESCENDING".equalsIgnoreCase(type)) {
                savedEngagement = descendingEngine.initializeAuction(newEngagement);
            } else if ("ASCENDING".equalsIgnoreCase(type)) {
                if ("OPEN".equals(format)) {
                    savedEngagement = openAscendingEngine.initializeAuction(newEngagement);
                } else {
                    savedEngagement = ascendingEngine.initializeAuction(newEngagement);
                }
            } else {
                return ResponseEntity.badRequest().body("Invalid auction type.");
            }

            return ResponseEntity.ok(savedEngagement);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping
    public ResponseEntity<List<Engagement>> getAllEngagements() {
        return ResponseEntity.ok(engagementRepository.findAllByOrderByIdDesc());
    }

    @GetMapping("/live")
    public ResponseEntity<List<Engagement>> getLiveEngagements() {
        return ResponseEntity.ok(engagementRepository.findByStatusOrderByIdDesc(Engagement.AuctionStatus.PHASE_2_LIVE));
    }

    @GetMapping("/my")
    public ResponseEntity<?> getMyAuctions(
            @RequestParam String email,
            @RequestParam String role) {
        if (email == null || email.isBlank()) {
            return ResponseEntity.badRequest().body("email is required.");
        }
        if ("BEARER".equalsIgnoreCase(role)) {
            return ResponseEntity.ok(engagementRepository.findMyAuctionsAsBearer(email));
        } else if ("BIDDER".equalsIgnoreCase(role)) {
            return ResponseEntity.ok(engagementRepository.findMyAuctionsAsBidder(email));
        } else {
            return ResponseEntity.badRequest().body("Invalid role. Must be BEARER or BIDDER.");
        }
    }
}