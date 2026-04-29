package com.snatch.api.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.Submission;
import com.snatch.api.models.Submission.SubmissionPhase;

@Repository
public interface SubmissionRepository extends JpaRepository<Submission, Long> {
    Submission findFirstByEngagementIdAndPhaseOrderByRateAsc(Long engagementId, SubmissionPhase phase);
}