# Firebase Python Integration for TalentBridge
# This module provides Python backend services for advanced features

import firebase_admin
from firebase_admin import credentials, firestore, auth
import os
from typing import Dict, List, Optional
import json
from datetime import datetime

# Initialize Firebase Admin SDK
def initialize_firebase():
    """Initialize Firebase Admin SDK with service account credentials"""
    try:
        # For local development - you'll need to download service account key from Firebase Console
        cred = credentials.Certificate('path/to/serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
        print("✅ Firebase Admin SDK initialized successfully")
    except Exception as e:
        print(f"❌ Firebase initialization failed: {e}")
        # For production, use environment variables or other secure methods

# Firestore Database Operations
class TalentBridgeDB:
    def __init__(self):
        self.db = firestore.client()

    def get_candidate_answers(self, candidate_id: str) -> Optional[Dict]:
        """Fetch candidate interview answers from Firestore"""
        try:
            doc_ref = self.db.collection('candidates').document(candidate_id)
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            return None
        except Exception as e:
            print(f"Error fetching candidate answers: {e}")
            return None

    def save_evaluation_report(self, candidate_id: str, evaluation_data: Dict):
        """Save detailed evaluation report to Firestore"""
        try:
            doc_ref = self.db.collection('evaluations').document()
            evaluation_data['timestamp'] = datetime.now()
            evaluation_data['candidate_id'] = candidate_id
            doc_ref.set(evaluation_data)
            return doc_ref.id
        except Exception as e:
            print(f"Error saving evaluation: {e}")
            return None

    def get_all_candidates(self) -> List[Dict]:
        """Get all candidates with their interview data"""
        try:
            candidates_ref = self.db.collection('candidates')
            docs = candidates_ref.stream()
            candidates = []
            for doc in docs:
                candidate_data = doc.to_dict()
                candidate_data['id'] = doc.id
                candidates.append(candidate_data)
            return candidates
        except Exception as e:
            print(f"Error fetching candidates: {e}")
            return []

# Advanced Evaluation Engine (ML-ready)
class InterviewEvaluator:
    def __init__(self):
        # Initialize ML models here (e.g., BERT for text analysis, etc.)
        pass

    def evaluate_answers_advanced(self, questions: List[str], answers: List[str]) -> Dict:
        """
        Advanced evaluation using NLP and ML techniques
        Returns detailed scoring with insights
        """
        evaluation = {
            'overall_score': 0,
            'question_scores': [],
            'strengths': [],
            'weaknesses': [],
            'recommendations': [],
            'competency_analysis': {}
        }

        # Basic scoring (can be enhanced with ML models)
        total_score = 0
        for i, (question, answer) in enumerate(zip(questions, answers)):
            question_score = self._score_single_answer(question, answer)
            evaluation['question_scores'].append({
                'question_number': i + 1,
                'question': question,
                'answer': answer,
                'score': question_score,
                'feedback': self._generate_feedback(question, answer, question_score)
            })
            total_score += question_score

        evaluation['overall_score'] = total_score / len(questions) if questions else 0

        # Generate insights
        evaluation.update(self._analyze_competencies(evaluation['question_scores']))

        return evaluation

    def _score_single_answer(self, question: str, answer: str) -> float:
        """Score individual answer based on multiple criteria"""
        score = 0

        # Length and completeness (30%)
        word_count = len(answer.split())
        length_score = min(30, (word_count / 50) * 30)
        score += length_score

        # Relevance to question (40%)
        relevance_score = self._calculate_relevance(question, answer) * 40
        score += relevance_score

        # Quality indicators (30%)
        quality_score = self._assess_answer_quality(answer) * 30
        score += quality_score

        return round(score, 1)

    def _calculate_relevance(self, question: str, answer: str) -> float:
        """Calculate how relevant the answer is to the question"""
        question_words = set(question.lower().split())
        answer_words = set(answer.lower().split())

        # Simple word overlap calculation
        overlap = len(question_words.intersection(answer_words))
        total_unique = len(question_words.union(answer_words))

        return overlap / total_unique if total_unique > 0 else 0

    def _assess_answer_quality(self, answer: str) -> float:
        """Assess answer quality based on structure and content"""
        quality_indicators = [
            'because', 'therefore', 'for example', 'specifically',
            'experience', 'project', 'developed', 'implemented',
            'learned', 'achieved', 'responsible for'
        ]

        indicator_count = sum(1 for indicator in quality_indicators
                            if indicator in answer.lower())

        # Normalize to 0-1 scale
        return min(1.0, indicator_count / 3)

    def _generate_feedback(self, question: str, answer: str, score: float) -> str:
        """Generate specific feedback for the answer"""
        if score >= 80:
            return "Excellent answer with strong detail and relevance."
        elif score >= 60:
            return "Good answer, but could benefit from more specific examples."
        elif score >= 40:
            return "Basic answer. Consider providing more context and examples."
        else:
            return "Answer needs more detail and relevance to the question."

    def _analyze_competencies(self, question_scores: List[Dict]) -> Dict:
        """Analyze competency patterns across all answers"""
        # This could be enhanced with ML clustering
        strengths = []
        weaknesses = []
        recommendations = []

        avg_score = sum(qs['score'] for qs in question_scores) / len(question_scores)

        if avg_score > 70:
            strengths.append("Strong communication skills")
            recommendations.append("Consider leadership roles")
        elif avg_score < 50:
            weaknesses.append("Needs improvement in technical communication")
            recommendations.append("Focus on developing clearer explanations")

        return {
            'strengths': strengths,
            'weaknesses': weaknesses,
            'recommendations': recommendations
        }

# Email Notification Service
class NotificationService:
    def __init__(self):
        # Initialize email service (e.g., SendGrid, AWS SES, etc.)
        pass

    def send_evaluation_complete(self, candidate_email: str, evaluation_data: Dict):
        """Send evaluation completion notification to candidate"""
        subject = "Your Interview Evaluation is Complete"
        body = f"""
        Dear Candidate,

        Your interview evaluation has been completed.

        Overall Score: {evaluation_data.get('overall_score', 0)}%

        Key Strengths:
        {chr(10).join('- ' + s for s in evaluation_data.get('strengths', []))}

        Areas for Improvement:
        {chr(10).join('- ' + w for w in evaluation_data.get('weaknesses', []))}

        Next Steps:
        {chr(10).join('- ' + r for r in evaluation_data.get('recommendations', []))}

        Best regards,
        TalentBridge Team
        """

        # Send email logic here
        print(f"📧 Email sent to {candidate_email}: {subject}")

    def notify_recruiter_new_candidate(self, recruiter_email: str, candidate_info: Dict):
        """Notify recruiter of new candidate submission"""
        subject = "New Candidate Interview Submitted"
        body = f"""
        A new candidate has submitted their interview answers.

        Candidate: {candidate_info.get('email', 'Unknown')}
        Questions Answered: {len(candidate_info.get('answers', []))}

        Please review their evaluation in the recruiter dashboard.
        """

        print(f"📧 Notification sent to recruiter {recruiter_email}")

# Analytics and Reporting
class AnalyticsService:
    def __init__(self, db: TalentBridgeDB):
        self.db = db

    def generate_recruiter_report(self, recruiter_id: str) -> Dict:
        """Generate comprehensive report for recruiter"""
        # Fetch all evaluations by this recruiter
        # Calculate statistics, trends, etc.
        report = {
            'total_evaluations': 0,
            'average_score': 0,
            'top_performers': [],
            'common_feedback': [],
            'monthly_trends': []
        }

        return report

    def export_candidate_data(self, candidate_id: str) -> str:
        """Export candidate data as JSON for external analysis"""
        candidate_data = self.db.get_candidate_answers(candidate_id)
        if candidate_data:
            return json.dumps(candidate_data, indent=2, default=str)
        return "{}"

# Main Application Class
class TalentBridgeApp:
    def __init__(self):
        initialize_firebase()
        self.db = TalentBridgeDB()
        self.evaluator = InterviewEvaluator()
        self.notifier = NotificationService()
        self.analytics = AnalyticsService(self.db)

    def process_candidate_evaluation(self, candidate_id: str):
        """Complete evaluation pipeline for a candidate"""
        # 1. Fetch candidate data
        candidate_data = self.db.get_candidate_answers(candidate_id)
        if not candidate_data:
            print(f"❌ Candidate {candidate_id} not found")
            return

        # 2. Get questions (assuming stored separately or hardcoded)
        questions = self._get_interview_questions()

        # 3. Perform advanced evaluation
        evaluation = self.evaluator.evaluate_answers_advanced(
            questions,
            candidate_data.get('answers', [])
        )

        # 4. Save evaluation results
        evaluation_id = self.db.save_evaluation_report(candidate_id, evaluation)

        # 5. Send notifications
        self.notifier.send_evaluation_complete(
            candidate_data.get('email', ''),
            evaluation
        )

        print(f"✅ Evaluation completed for candidate {candidate_id}")
        return evaluation_id

    def _get_interview_questions(self) -> List[str]:
        """Fetch current interview questions"""
        # In a real app, this would fetch from database
        return [
            "Tell me about yourself and your background.",
            "What are your greatest strengths?",
            "Describe a challenging project you worked on.",
            "Where do you see yourself in 5 years?",
            "Why are you interested in this position?"
        ]

# Example usage
if __name__ == "__main__":
    app = TalentBridgeApp()

    # Process a candidate evaluation
    candidate_id = "example_candidate_id"
    app.process_candidate_evaluation(candidate_id)

    # Generate analytics report
    # report = app.analytics.generate_recruiter_report("recruiter_id")
    # print(json.dumps(report, indent=2))