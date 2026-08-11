using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// Task 04 example fixtures: explicit Level 2 handlers that delegate to Level 1's own
// decision-method discovery (IDecider) rather than duplicating the aggregate's
// transition logic (D1), for both the mutate (Approve) and create (Create) paths.

public interface IReviewNotesProvider
{
    string GetNotes(Guid documentId);
}

public class FakeReviewNotesProvider : IReviewNotesProvider
{
    public List<Guid> RequestedFor { get; } = [];

    public string GetNotes(Guid documentId)
    {
        RequestedFor.Add(documentId);
        return $"notes-for-{documentId}";
    }
}

// Orchestration/I-O (reading review notes via an injected dependency) before delegating
// to Level 1's own Approve decider for the actual transition (AC2/AC3).
public class ApproveDocumentEventSourcedHandler(IDecider decider, IReviewNotesProvider notesProvider)
    : IEventSourcedCommandHandler<ApproveDocument, Document, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(ApproveDocument command, Option<Document> aggregate, CancellationToken cancellationToken)
    {
        _ = notesProvider.GetNotes(command.DocumentId);
        return decider.DecideAsync(aggregate, command, cancellationToken);
    }
}

// Pure delegation to Level 1's creation decision path for the None case (AC5).
public class CreateDocumentEventSourcedHandler(IDecider decider)
    : IEventSourcedCommandHandler<CreateDocument, Document, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(CreateDocument command, Option<Document> aggregate, CancellationToken cancellationToken)
        => decider.DecideAsync(aggregate, command, cancellationToken);
}
