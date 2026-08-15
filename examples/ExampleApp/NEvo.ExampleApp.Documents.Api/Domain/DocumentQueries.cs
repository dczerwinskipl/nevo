using LanguageExt;
using NEvo.Core;
using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Queries;

namespace NEvo.ExampleApp.Documents.Api.Domain;

/// <summary>Read-model representation of a document.</summary>
public record DocumentDto(Guid DocumentId, string Data, bool Approved, Guid? ApprovedBy);

/// <summary>Retrieves a document by id.</summary>
public record GetDocumentQuery(Guid DocumentId) : Query<DocumentDto>;

/// <summary>Thrown when the requested document does not exist.</summary>
public class DocumentNotFoundException(Guid documentId) : Exception($"Document '{documentId}' was not found.");

/// <summary>Handles <see cref="GetDocumentQuery"/>.</summary>
/// <remarks>
/// This compact example reads current aggregate state directly through <see
/// cref="IAggregateRepository"/> rather than a persisted projection — persisted
/// projection infrastructure is intentionally not part of this example yet.
/// </remarks>
public class GetDocumentQueryHandler(IAggregateRepository repository) : IQueryHandler<GetDocumentQuery, DocumentDto>
{
    public async Task<Either<Exception, DocumentDto>> HandleAsync(GetDocumentQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
        => await repository.LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
            .RequireSome(() => new DocumentNotFoundException(query.DocumentId))
            .Map(loaded => ToDto(loaded.Aggregate));

    private static DocumentDto ToDto(Document document) => document switch
    {
        ApprovedDocument approved => new(approved.Id, approved.Data, Approved: true, approved.ApprovedBy),
        _ => new(document.Id, document.Data, Approved: false, ApprovedBy: null)
    };
}
