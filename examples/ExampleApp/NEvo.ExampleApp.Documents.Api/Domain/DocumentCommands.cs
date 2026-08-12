using NEvo.Ddd.EventSourcing;
using NEvo.ExampleApp.Documents.Api.Authorization;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public record DocumentCommand(Guid DocumentId) : Command, IAggregateCommand<Document, Guid>
{
    public Guid StreamId => DocumentId;
}

/// <summary>Creates a new document.</summary>
public record CreateDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);

/// <summary>Changes an existing document's data.</summary>
public record ChangeDocument(Guid DocumentId, string Data) : DocumentCommand(DocumentId);

/// <summary>
/// Requests approval of a document. Requires the <see
/// cref="DocumentPermissions.ApproveDocument"/> permission — enforced before the handler
/// runs; the attribute below is the source of truth for that requirement.
/// </summary>
[AllowPermission(DocumentPermissions.ApproveDocument, typeof(ApproveDocumentPermissionValidator))]
public record ApproveDocument(Guid DocumentId) : DocumentCommand(DocumentId);
