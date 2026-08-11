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

    public Either<Exception, IEnumerable<DocumentDomainEvent>> Approve(ApproveDocument command)
    {
        return new[] { new DocumentApproved(Id) };
    }

    // Evolver — each application returns a new, independent state object rather than
    // mutating this one.
    public EditableDocument Apply(DocumentChanged @event)
        => new(Id, @event.Data);

    public ApprovedDocument Apply(DocumentApproved @event)
        => new(Id, Data);
}

public sealed class ApprovedDocument(Guid id, string data) : Document(id, data)
{
}
