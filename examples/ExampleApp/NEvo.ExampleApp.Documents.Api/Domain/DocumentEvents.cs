using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Events;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public abstract record DocumentDomainEvent(Guid DocumentId) : Event, IAggregateEvent<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

public record DocumentCreated(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);
public record DocumentChanged(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);
public record DocumentApproved(Guid DocumentId, Guid ApprovedBy) : DocumentDomainEvent(DocumentId);
