package com.snatch.api.repositories;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.Submission;
import com.snatch.api.models.Submission.SubmissionPhase;

@Repository
public interface SubmissionRepository extends JpaRepository<Submission, Long> {
    Submission findFirstByEngagementIdAndPhaseOrderByRateAsc(Long engagementId, SubmissionPhase phase);
    Submission findFirstByEngagementIdAndPhaseOrderByRateDesc(Long engagementId, SubmissionPhase phase);
    boolean existsByEngagementIdAndProviderIdAndPhase(Long engagementId, String providerId, SubmissionPhase phase);

    @Query("SELECT DISTINCT s.providerId FROM Submission s WHERE s.engagement.id = :engagementId AND s.phase = :phase")
    List<String> findDistinctProviderIdsByEngagementIdAndPhase(@Param("engagementId") Long engagementId, @Param("phase") SubmissionPhase phase);
    
    Submission findFirstByEngagementIdAndProviderIdOrderBySubmittedAtDesc(Long engagementId, String providerId);
    Submission findFirstByEngagementIdAndProviderIdAndPhaseOrderBySubmittedAtDesc(Long engagementId, String providerId, SubmissionPhase phase);
    
    @Query("SELECT s FROM Submission s WHERE s.engagement.id = :engagementId AND s.phase = :phase ORDER BY s.submittedAt DESC")
    List<Submission> findByEngagementIdAndPhaseOrderBySubmittedAtDesc(@Param("engagementId") Long engagementId, @Param("phase") SubmissionPhase phase);
}