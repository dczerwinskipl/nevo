using LanguageExt;
using NEvo.Ddd.EventSourcing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Queries;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

public record DocumentDto(Guid DocumentId, string Data, bool Approved) : IProjectable<Guid>
{
    public Guid Id => DocumentId;
}

public record GetDocumentQuery(Guid DocumentId) : Query<DocumentDto>;

public class DocumentNotFoundException(Guid documentId) : Exception($"Document '{documentId}' was not found.");

// Reads through IEventStore.LoadProjectionAsync, currently backed by the
// InMemoryDocumentEventStore workaround (see that class) pending PR #10's real
// event-sourcing repository.
public class GetDocumentQueryHandler(InMemoryDocumentEventStore eventStore) : IQueryHandler<GetDocumentQuery, DocumentDto>
{
    public Task<Either<Exception, DocumentDto>> HandleAsync(GetDocumentQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
        => eventStore.LoadProjectionAsync<DocumentDto, Guid>(query.DocumentId).Match(
            Some: dto => Either<Exception, DocumentDto>.Right(dto),
            None: () => Either<Exception, DocumentDto>.Left(new DocumentNotFoundException(query.DocumentId))
        );
}
