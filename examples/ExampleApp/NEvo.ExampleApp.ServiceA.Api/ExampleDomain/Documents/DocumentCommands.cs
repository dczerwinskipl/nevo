using NEvo.Ddd.EventSourcing.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

public record DocumentCommand(Guid DocumentId) : Command, IAggregateCommand<DocumentAggregateBase, Guid>
{
    public Guid StreamId => DocumentId;
}

public record CreateDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId), ICreateAggregateCommand<DocumentAggregateBase, Guid>;
public record ChangeDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);
public record ApproveDocument(Guid DocumentId) : DocumentCommand(DocumentId);
