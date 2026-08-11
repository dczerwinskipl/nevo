using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A second concrete state type that also declares a decider for ChangeDocument, so a
// ReviewableDocument runtime instance has two candidate declaring types
// (EditableDocument, ReviewableDocument) both assignable from its runtime type, with
// ReviewableDocument strictly more specific. Used both by
// AmbiguityResolutionBaselineTests to characterize the pre-hardening first-match
// behavior, and by AmbiguityResolutionTests.MostSpecificDeclaringTypeWins to prove the
// *new* deterministic most-specific-wins resolution reaches the same answer for a
// principled reason instead of by enumeration-order luck.
public class ReviewableDocument(Guid id, string data) : EditableDocument(id, data)
{
    public new Either<Exception, IEnumerable<DocumentDomainEvent>> Change(ChangeDocument command)
    {
        // Data is suffixed so a test can tell which of the two candidate declaring
        // types (EditableDocument vs ReviewableDocument) actually resolved, rather than
        // the two candidates being indistinguishable.
        return new[] { new DocumentChanged(Id, command.Data + "-Reviewable") };
    }

    // Two differently-named methods on the exact same declaring type, both valid
    // deciders for the same command — a genuine tie at the most-specific level: neither
    // dominates the other, so resolution must fail deterministically rather than
    // silently picking one.
    public Either<Exception, IEnumerable<DocumentDomainEvent>> MarkReviewed(ReviewDocument command)
        => new DocumentDomainEvent[] { new DocumentReviewed(Id) };

    public Either<Exception, IEnumerable<DocumentDomainEvent>> FinishReview(ReviewDocument command)
        => new DocumentDomainEvent[] { new DocumentReviewed(Id) };
}

public record ReviewDocument(Guid DocumentId) : DocumentCommand(DocumentId);

public record DocumentReviewed(Guid DocumentId) : DocumentDomainEvent(DocumentId);

// Reaches ReviewableDocument through ordinary replay (EditableDocument.Apply, in
// Document.cs) rather than direct construction, so tests can exercise most-specific
// decider resolution against a rehydrated aggregate via the real dispatch path.
public record FlagDocumentForReview(Guid DocumentId) : DocumentCommand(DocumentId);

public record DocumentFlaggedForReview(Guid DocumentId) : DocumentDomainEvent(DocumentId);
