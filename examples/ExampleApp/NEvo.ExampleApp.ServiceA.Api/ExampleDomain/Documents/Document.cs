using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

public abstract class Document(Guid id, string data) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;
    public string Data { get; set; } = data;

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


public class EditableDocument(Guid id, string data) : Document(id, data)
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

    // Evolver
    public Document Apply(DocumentChanged @event)
    {
        return new EditableDocument(Id, @event.Data);
    }

    public Document Apply(DocumentApproved @event)
    {
        return new ApprovedDocument(Id, Data);
    }
}

public class ApprovedDocument(Guid id, string data) : Document(id, data)
{
}