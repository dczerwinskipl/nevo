using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Events;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public abstract record DocumentDomainEvent(Guid DocumentId) : Event, IAggregateEvent<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

/// <summary>A document was created.</summary>
public record DocumentCreated(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);

/// <summary>A document's data was changed.</summary>
public record DocumentChanged(Guid DocumentId, string Data) : DocumentDomainEvent(DocumentId);

/// <summary>A document was approved, recording the approver's identifier.</summary>
public record DocumentApproved(Guid DocumentId, Guid ApprovedBy) : DocumentDomainEvent(DocumentId);
