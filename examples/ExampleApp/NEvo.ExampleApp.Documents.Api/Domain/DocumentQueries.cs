using LanguageExt;
using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Queries;

namespace NEvo.ExampleApp.Documents.Api.Domain;

public record DocumentDto(Guid DocumentId, string Data, bool Approved) : IProjectable<Guid>
{
    public Guid Id => DocumentId;
}

public record GetDocumentQuery(Guid DocumentId) : Query<DocumentDto>;

public class DocumentNotFoundException(Guid documentId) : Exception($"Document '{documentId}' was not found.");

// Intermediate/simple read path: reads the current aggregate state directly through
// IAggregateRepository rather than a persisted projection. Sufficient for this compact
// example — not the general recommendation for Event Sourcing read models once
// persisted-projection support exists.
public class GetDocumentQueryHandler(IAggregateRepository repository) : IQueryHandler<GetDocumentQuery, DocumentDto>
{
    public async Task<Either<Exception, DocumentDto>> HandleAsync(GetDocumentQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
        => await repository.LoadAggregateAsync<Document, Guid>(query.DocumentId, cancellationToken)
            .MapAsync(Some: loaded => ToDto(loaded.Aggregate), None: () => new DocumentNotFoundException(query.DocumentId));

    private static DocumentDto ToDto(Document document) => new(document.Id, document.Data, document is ApprovedDocument);
}
