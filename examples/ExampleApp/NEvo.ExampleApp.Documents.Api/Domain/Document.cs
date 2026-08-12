using LanguageExt;
using NEvo.Ddd.EventSourcing;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public abstract class Document(Guid id, string data) : IAggregateRoot<Guid>
{
    public Guid Id { get; } = id;
    public string Data { get; } = data;

    // Decider - create
    public static Either<Exception, IEnumerable<DocumentDomainEvent>> Create(CreateDocument command)
    {
        return new[] { new DocumentCreated(command.DocumentId, command.Data) };
    }

    // Evolver - initial state
    public static Document Apply(DocumentCreated @event)
    {
        return new EditableDocument(@event.DocumentId, @event.Data);
    }
}

public sealed class EditableDocument(Guid id, string data) : Document(id, data)
{
    // Decider
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Change(ChangeDocument command)
    {
        return new[] { new DocumentChanged(Id, command.Data) };
    }

    // Level 1 convention decider for ApproveDocument. Never actually routed to at
    // runtime — ApproveDocumentHandler (Level 2) is registered as Primary for
    // ApproveDocument, so this convention route stays Fallback and unused (D3) — but it
    // still needs to exist, because the explicit handler delegates to it via
    // IAggregateMethodDecider for the actual transition instead of duplicating it.
    // ApprovedBy is not knowable here (a decision method has no orchestration/DI
    // capability, only the command and current state); it is resolved from the
    // current-user context and applied by the explicit handler after this call returns.
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Approve(ApproveDocument command)
    {
        return new[] { new DocumentApproved(Id, ApprovedBy: Guid.Empty) };
    }

    // Evolver — each application returns a new, independent state object rather than
    // mutating this one.
    public EditableDocument Apply(DocumentChanged @event)
        => new(Id, @event.Data);

    public ApprovedDocument Apply(DocumentApproved @event)
        => new(Id, Data, @event.ApprovedBy);
}

public sealed class ApprovedDocument(Guid id, string data, Guid approvedBy) : Document(id, data)
{
    public Guid ApprovedBy { get; } = approvedBy;
}
