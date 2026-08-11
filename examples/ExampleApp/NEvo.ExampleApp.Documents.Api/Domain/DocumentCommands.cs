using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public record DocumentCommand(Guid DocumentId) : Command, IAggregateCommand<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

public record CreateDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);
public record ChangeDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);
public record ApproveDocument(Guid DocumentId) : DocumentCommand(DocumentId);
