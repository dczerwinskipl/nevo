using LanguageExt;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// Explicit Level 2 handlers that delegate to the aggregate-method convention (via
// IAggregateMethodDecider) rather than duplicating the aggregate's transition logic,
// for both the mutate (Approve) and create (Create) paths.

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
// to the convention's own Approve decision for the actual transition.
public class ApproveDocumentEventSourcedHandler(IAggregateMethodDecider aggregateDecider, IReviewNotesProvider notesProvider)
    : IEventSourcedCommandHandler<ApproveDocument, Document, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(ApproveDocument command, Option<Document> aggregate, CancellationToken cancellationToken)
    {
        _ = notesProvider.GetNotes(command.DocumentId);
        return aggregateDecider.DecideAsync(aggregate, command, cancellationToken);
    }
}

// Pure delegation to the convention's creation decision path for the None case.
public class CreateDocumentEventSourcedHandler(IAggregateMethodDecider aggregateDecider)
    : IEventSourcedCommandHandler<CreateDocument, Document, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(CreateDocument command, Option<Document> aggregate, CancellationToken cancellationToken)
        => aggregateDecider.DecideAsync(aggregate, command, cancellationToken);
}
