package com.snatch.api.controllers;

import com.snatch.api.models.AuctionItem;
import com.snatch.api.models.Engagement;
import com.snatch.api.models.Seat;
import com.snatch.api.repositories.AuctionItemRepository;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.services.OpenAscendingAuctionService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/engagements")
public class OpenAuctionController {

    private final EngagementRepository engagementRepository;
    private final AuctionItemRepository itemRepository;
    private final OpenAscendingAuctionService openService;

    public OpenAuctionController(EngagementRepository engagementRepository,
                                 AuctionItemRepository itemRepository,
                                 OpenAscendingAuctionService openService) {
        this.engagementRepository = engagementRepository;
        this.itemRepository = itemRepository;
        this.openService = openService;
    }

    @PostMapping("/{id}/open/items")
    @Transactional
    @SuppressWarnings("UnnecessaryTemporaryOnConversionFromString")
    public ResponseEntity<?> uploadItems(@PathVariable Long id,
                                         @RequestBody Map<String, String> body) {
        Engagement eng = engagementRepository.findById(id).orElse(null);
        if (eng == null) return ResponseEntity.notFound().build();
        if (!"OPEN".equalsIgnoreCase(eng.getAuctionFormat())) {
            return ResponseEntity.badRequest().body("This auction is not OPEN format.");
        }
        if (eng.getStatus() != Engagement.AuctionStatus.PENDING) {
            return ResponseEntity.badRequest().body("Items can only be uploaded before the auction starts.");
        }

        String text = body.getOrDefault("text", "");
        List<AuctionItem> parsed = new ArrayList<>();
        int seq = 0;
        int lineNumber = 0;
        for (String rawLine : text.split("\\r?\\n")) {
            lineNumber++;
            String line = rawLine.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;

            String name;
            String description = null;
            Double price = null;

            if (line.contains("|")) {
                String[] parts = line.split("\\|");
                for (int i = 0; i < parts.length; i++) parts[i] = parts[i].trim();
                name = parts[0];
                if (parts.length >= 3) {
                    description = parts[1].isEmpty() ? null : parts[1];
                    try { price = Double.parseDouble(parts[2]); }
                    catch (NumberFormatException nfe) {
                        description = (description == null ? "" : description + " ") + parts[2];
                    }
                } else if (parts.length == 2) {
                    try { price = Double.parseDouble(parts[1]); }
                    catch (NumberFormatException nfe) {
                        description = parts[1].isEmpty() ? null : parts[1];
                    }
                }
            } else {
                int comma = line.lastIndexOf(',');
                if (comma >= 0) {
                    String maybePrice = line.substring(comma + 1).trim();
                    try {
                        price = Double.parseDouble(maybePrice);
                        name = line.substring(0, comma).trim();
                    } catch (NumberFormatException nfe) {
                        name = line;
                    }
                } else {
                    name = line;
                }
            }
            if (name == null || name.isEmpty()) continue;

            // Starting price is REQUIRED — an OPEN ascending auction can't
            // begin at zero or no price (every bid would have to be > 0, but
            // the bidder has no anchor for what's reasonable). Reject the
            // whole upload and tell the bearer exactly which line is bad.
            if (price == null || price <= 0) {
                return ResponseEntity.badRequest().body(Map.of(
                        "message", "Line " + lineNumber + " (\"" + line + "\") is missing a starting price. "
                                + "Every item needs a starting price greater than zero. "
                                + "Use \"Name, 100\" or \"Name | Description | 100\"."
                ));
            }

            AuctionItem item = new AuctionItem();
            item.setEngagement(eng);
            item.setName(name);
            item.setStartingPrice(price);
            item.setDescription(description);
            item.setSequenceOrder(seq++);
            item.setStatus(AuctionItem.ItemStatus.PENDING);
            parsed.add(item);
        }

        if (parsed.isEmpty()) {
            return ResponseEntity.badRequest().body("No valid item lines found.");
        }

        List<AuctionItem> existing = itemRepository.findByEngagementIdOrderBySequenceOrderAsc(id);
        itemRepository.deleteAll(existing);
        itemRepository.saveAll(parsed);

        return ResponseEntity.ok(Map.of("count", parsed.size(), "items", parsed));
    }

    @GetMapping("/{id}/open/items")
    public ResponseEntity<List<AuctionItem>> listItems(@PathVariable Long id) {
        return ResponseEntity.ok(itemRepository.findByEngagementIdOrderBySequenceOrderAsc(id));
    }

    @GetMapping("/{id}/open/won")
    public ResponseEntity<List<AuctionItem>> listWonByBidder(@PathVariable Long id,
                                                             @RequestParam String providerId) {
        return ResponseEntity.ok(itemRepository.findByEngagementIdAndWinnerIdOrderBySequenceOrderAsc(id, providerId));
    }

    /**
     * Pre-auction catalog. Bidders download this to preview what's coming up.
     * Plain text, readable in any editor.
     */
    @GetMapping("/{id}/open/catalog")
    public ResponseEntity<?> downloadCatalog(@PathVariable Long id) {
        Engagement eng = engagementRepository.findById(id).orElse(null);
        if (eng == null) return ResponseEntity.notFound().build();
        if (!"OPEN".equalsIgnoreCase(eng.getAuctionFormat())) {
            return ResponseEntity.badRequest().body("Catalog is only available for OPEN auctions.");
        }

        List<AuctionItem> items = itemRepository.findByEngagementIdOrderBySequenceOrderAsc(id);
        StringBuilder sb = new StringBuilder();
        sb.append("===========================================\n");
        sb.append("  ").append(eng.getTitle()).append("\n");
        sb.append("===========================================\n");
        if (eng.getDescription() != null && !eng.getDescription().isBlank()) {
            sb.append(eng.getDescription()).append("\n\n");
        }
        sb.append("Format       : Open-Floor Ascending\n");
        sb.append("Items listed : ").append(items.size()).append("\n");
        if (eng.getAuctioneerName() != null && !eng.getAuctioneerName().isBlank()) {
            sb.append("Auctioneer   : ").append(eng.getAuctioneerName()).append("\n");
        }
        if (eng.getOpenStartTime() != null) {
            sb.append("Starts (UTC) : ").append(eng.getOpenStartTime()).append("\n");
        }
        sb.append("\n-------------------------------------------\n");
        sb.append("                 CATALOG\n");
        sb.append("-------------------------------------------\n\n");

        int idx = 1;
        for (AuctionItem it : items) {
            sb.append("Lot ").append(idx++).append(" — ").append(it.getName()).append("\n");
            if (it.getStartingPrice() != null && it.getStartingPrice() > 0) {
                sb.append("  Starting price: $").append(String.format("%.2f", it.getStartingPrice())).append("\n");
            }
            if (it.getDescription() != null && !it.getDescription().isBlank()) {
                // Word-wrap descriptions at 70 chars for readable plain text.
                String desc = it.getDescription();
                int width = 70;
                String[] words = desc.split("\\s+");
                StringBuilder line = new StringBuilder("  ");
                for (String w : words) {
                    if (line.length() + w.length() + 1 > width + 2) {
                        sb.append(line).append("\n");
                        line = new StringBuilder("  ");
                    }
                    if (line.length() > 2) line.append(' ');
                    line.append(w);
                }
                if (line.length() > 2) sb.append(line).append("\n");
            }
            sb.append("\n");
        }
        sb.append("-------------------------------------------\n");
        sb.append("End of catalog. Good luck!\n");

        String filename = "snatch-catalog-" + id + ".txt";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.TEXT_PLAIN)
                .body(sb.toString());
    }

    @PostMapping("/{id}/open/seats")
    public ResponseEntity<?> claimSeat(@PathVariable Long id,
                                       @RequestBody Map<String, Object> body) {
        try {
            String bidderEmail = (String) body.get("bidderEmail");
            Integer seatIndex = body.get("seatIndex") == null
                    ? null
                    : Integer.valueOf(body.get("seatIndex").toString());
            Seat seat = openService.claimSeat(id, bidderEmail, seatIndex);
            return ResponseEntity.ok(Map.of(
                    "seatIndex", seat.getSeatIndex(),
                    "bidderEmail", seat.getBidderEmail()
            ));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @GetMapping("/{id}/open/seats")
    public ResponseEntity<?> listSeats(@PathVariable Long id) {
        List<Seat> seats = openService.getSeats(id);
        return ResponseEntity.ok(seats.stream().map(s -> Map.of(
                "seatIndex", s.getSeatIndex(),
                "bidderEmail", s.getBidderEmail()
        )).toList());
    }

    @PostMapping("/{id}/open/start")
    public ResponseEntity<?> startAuction(@PathVariable Long id) {
        try {
            Engagement saved = openService.startOpenAuction(id);
            return ResponseEntity.ok(saved);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/{id}/open/stop")
    public ResponseEntity<?> stopAuction(@PathVariable Long id) {
        try {
            Engagement saved = openService.stopOpenAuction(id);
            return ResponseEntity.ok(saved);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    /**
     * Bidder passes on the current item only. Seat preserved for next items.
     */
    @PostMapping("/{id}/open/pass")
    public ResponseEntity<?> passCurrentItem(@PathVariable Long id,
                                             @RequestBody Map<String, String> body) {
        try {
            String bidderEmail = body.get("bidderEmail");
            if (bidderEmail == null || bidderEmail.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("message", "bidderEmail is required."));
            }
            openService.passCurrentItem(id, bidderEmail);
            return ResponseEntity.ok(Map.of("status", "passed"));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    /**
     * Bidder leaves the auction entirely. Seat freed; if seat grid becomes
     * empty mid-auction, the auction ends with ALL_PARTICIPANTS_LEFT.
     */
    @PostMapping("/{id}/open/leave")
    public ResponseEntity<?> leaveAuction(@PathVariable Long id,
                                          @RequestBody Map<String, String> body) {
        try {
            String bidderEmail = body.get("bidderEmail");
            if (bidderEmail == null || bidderEmail.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("message", "bidderEmail is required."));
            }
            openService.leaveAuction(id, bidderEmail);
            return ResponseEntity.ok(Map.of("status", "left"));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }
}