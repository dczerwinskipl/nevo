
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

public abstract record DocumentDomainEvent(Guid DocumentId) : Event, IAggregateEvent<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

public record DocumentCreated(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);
public record DocumentChanged(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);
public record DocumentApproved(Guid DocumentId) : DocumentDomainEvent(DocumentId);

