using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

public abstract class DocumentAggregateBase(Guid id) : IAggregateRoot<Guid, DocumentAggregateBase>
{
    public Guid Id { get; set; } = id;

    public static DocumentAggregateBase CreateEmpty(Guid id) => new EmptyDocument(id);
}

public class EmptyDocument(Guid id) : DocumentAggregateBase(id)
{
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Create(CreateDocument command)
    {
        return new[] { new DocumentCreated(Id, command.Data) };
    }

    public Document Apply(DocumentCreated @event)
    {
        return new EditableDocument(Id, @event.Data);
    }
}

public abstract class Document(Guid id, string Data) : DocumentAggregateBase(id)
{
    public string Data { get; set; } = Data;
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