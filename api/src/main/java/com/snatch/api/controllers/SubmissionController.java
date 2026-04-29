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
import com.snatch.api.services.DescendingAuctionService;

@RestController
@RequestMapping("/api/engagements")
public class SubmissionController {

    private final DescendingAuctionService descendingService;

    public SubmissionController(DescendingAuctionService descendingService) {
        this.descendingService = descendingService;
    }

    @PostMapping("/{id}/sealed-offers")
    public ResponseEntity<Submission> submitSealedOffer(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        Double rate = Double.valueOf(payload.get("rate").toString());
        
        Submission offer = descendingService.submitSealedOffer(id, providerId, rate);
        return ResponseEntity.ok(offer);
    }

    @PostMapping("/{id}/transition")
    public ResponseEntity<Engagement> transitionToLiveRound(@PathVariable Long id) {
        Engagement updatedEngagement = descendingService.transitionToLiveRound(id);
        return ResponseEntity.ok(updatedEngagement);
    }

    @PostMapping("/{id}/live-offers")
    public ResponseEntity<String> processLiveOffer(
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        
        String providerId = (String) payload.get("providerId");
        Double rate = Double.valueOf(payload.get("rate").toString());
        
        boolean accepted = descendingService.processLiveRate(id, providerId, rate);
        
        if (accepted) {
            return ResponseEntity.ok("Live rate successfully updated to $" + rate);
        } else {
            return ResponseEntity.badRequest().body("Offer rejected: Rate is not strictly lower than the current live rate.");
        }
    }
}