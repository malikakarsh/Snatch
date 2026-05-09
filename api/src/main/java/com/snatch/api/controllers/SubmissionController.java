package com.snatch.api.controllers;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Submission;
import com.snatch.api.services.AuctionEngine;

import org.springframework.beans.factory.annotation.Qualifier;

@RestController
@RequestMapping("/api/engagements")
public class SubmissionController {

    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;
    private final com.snatch.api.repositories.EngagementRepository engagementRepository;
    private final com.snatch.api.repositories.SubmissionRepository submissionRepository;
    private final com.snatch.api.repositories.RegistrationRepository registrationRepository;

    public SubmissionController(
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine,
            com.snatch.api.repositories.EngagementRepository engagementRepository,
            com.snatch.api.repositories.SubmissionRepository submissionRepository,
            com.snatch.api.repositories.RegistrationRepository registrationRepository) {
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
        this.engagementRepository = engagementRepository;
        this.submissionRepository = submissionRepository;
        this.registrationRepository = registrationRepository;
    }
    
    private AuctionEngine getEngineForEngagement(Long engagementId) {
        Engagement engagement = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));
        if ("DESCENDING".equalsIgnoreCase(engagement.getAuctionType())) {
            return descendingEngine;
        } else {
            return ascendingEngine;
        }
    }

    @PostMapping("/{id}/register")
    public ResponseEntity<String> registerForAuction(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        
        Engagement engagement = engagementRepository.findById(id).orElse(null);
        if (engagement == null) return ResponseEntity.notFound().build();

        java.util.Optional<com.snatch.api.models.Registration> existing = registrationRepository.findByEngagementIdAndProviderId(id, providerId);
        if (existing.isPresent()) {
            if (existing.get().isWithdrawn()) {
                return ResponseEntity.badRequest().body("You have already withdrawn from this auction.");
            }
            return ResponseEntity.badRequest().body("Already registered.");
        }

        com.snatch.api.models.Registration reg = new com.snatch.api.models.Registration();
        reg.setEngagement(engagement);
        reg.setProviderId(providerId);
        registrationRepository.save(reg);

        return ResponseEntity.ok("Successfully registered for the auction.");
    }

    @PostMapping("/{id}/sealed-offers")
    public ResponseEntity<Submission> submitSealedOffer(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        Double rate = Double.valueOf(payload.get("rate").toString());

        java.util.Optional<com.snatch.api.models.Registration> reg = registrationRepository.findByEngagementIdAndProviderId(id, providerId);
        if (reg.isEmpty() || reg.get().isWithdrawn()) {
            throw new IllegalStateException("Must be actively registered to submit an offer.");
        }
        
        AuctionEngine engine = getEngineForEngagement(id);
        Submission offer = engine.submitSealedOffer(id, providerId, rate);
        return ResponseEntity.ok(offer);
    }

    @PostMapping("/{id}/transition")
    public ResponseEntity<Engagement> transitionToLiveRound(@PathVariable Long id) {
        AuctionEngine engine = getEngineForEngagement(id);
        Engagement updatedEngagement = engine.transitionToLiveRound(id);
        return ResponseEntity.ok(updatedEngagement);
    }

    @PostMapping("/{id}/live-offers")
    public ResponseEntity<String> processLiveOffer(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        Double rate = Double.valueOf(payload.get("rate").toString());
        
        AuctionEngine engine = getEngineForEngagement(id);
        boolean accepted;
        try {
            accepted = engine.processLiveRate(id, providerId, rate);
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
        
        if (accepted) {
            return ResponseEntity.ok("Bid accepted.");
        } else {
            return ResponseEntity.badRequest().body("Offer rejected. Does not meet the rules for this auction.");
        }
    }

    @PostMapping("/{id}/quit")
    public ResponseEntity<String> quitAuction(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        
        java.util.Optional<com.snatch.api.models.Registration> reg = registrationRepository.findByEngagementIdAndProviderId(id, providerId);
        reg.ifPresent(r -> {
            r.setWithdrawn(true);
            registrationRepository.save(r);
        });

        AuctionEngine engine = getEngineForEngagement(id);
        engine.quitAuction(id, providerId);
        
        return ResponseEntity.ok("Successfully withdrawn from the auction.");
    }

    @org.springframework.web.bind.annotation.GetMapping("/{id}/my-status")
    public ResponseEntity<Map<String, Object>> getMyStatus(
            @PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam String providerId) {
        
        Engagement engagement = engagementRepository.findById(id).orElse(null);
        if (engagement == null) return ResponseEntity.notFound().build();

        Submission lastSub = submissionRepository.findFirstByEngagementIdAndProviderIdOrderBySubmittedAtDesc(id, providerId);
        
        Double lastBid = lastSub != null ? lastSub.getRate() : null;
        String signal = "N/A";

        if (lastBid != null && engagement.getCurrentLiveRate() != null) {
            double diff = Math.abs(lastBid - engagement.getCurrentLiveRate());
            double ratio = diff / engagement.getCurrentLiveRate();
            
            if (ratio <= 0.10) {
                signal = "CLOSE";
            } else if (ratio <= 0.25) {
                signal = "MID";
            } else {
                signal = "FAR";
            }
        }

        java.util.Optional<com.snatch.api.models.Registration> reg = registrationRepository.findByEngagementIdAndProviderId(id, providerId);
        boolean isRegistered = reg.isPresent();
        boolean isWithdrawn = reg.map(com.snatch.api.models.Registration::isWithdrawn).orElse(false);

        AuctionEngine engine = getEngineForEngagement(id);
        boolean isEligibleForPhase2 = engine.isEligibleForPhase2(id, providerId);

        Map<String, Object> response = new java.util.HashMap<>();
        response.put("lastBidRate", lastBid);
        response.put("signal", signal);
        response.put("isRegistered", isRegistered);
        response.put("isWithdrawn", isWithdrawn);
        response.put("isEligibleForPhase2", isEligibleForPhase2);

        return ResponseEntity.ok(response);
    }
}