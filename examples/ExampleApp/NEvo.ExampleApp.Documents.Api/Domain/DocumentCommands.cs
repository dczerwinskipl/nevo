using NEvo.Ddd.EventSourcing;
using NEvo.ExampleApp.Documents.Api.Authorization;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public record DocumentCommand(Guid DocumentId) : Command, IAggregateCommand<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

public record CreateDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);
public record ChangeDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);

// Message-level permission metadata (task 07 / D5): the requirement lives on the
// command itself and is enforced by ValidatePermissionMiddleware before the handler
// runs — not duplicated onto EditableDocument.Approve or ApproveDocumentHandler.
[AllowPermission(DocumentPermissions.ApproveDocument, typeof(ApproveDocumentPermissionValidator))]
public record ApproveDocument(Guid DocumentId) : DocumentCommand(DocumentId);
