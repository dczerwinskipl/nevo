using LanguageExt;
using NEvo.Ddd.EventSourcing;
using System.Collections.Concurrent;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// Example-only IEventStore: appends Document events into a real in-memory
// DocumentDto projection, so GetDocumentQuery can demonstrate a genuine
// create-then-query round trip. FakeEventStore (the framework default) never
// persists anything, so it cannot support that round trip.
public class InMemoryDocumentEventStore : IEventStore
{
    private readonly ConcurrentDictionary<Guid, DocumentDto> _documents = new();

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        foreach (var @event in events)
        {
            switch (@event)
            {
                case DocumentCreated created:
                    _documents[created.DocumentId] = new DocumentDto(created.DocumentId, created.Data, Approved: false);
                    break;
                case DocumentChanged changed when _documents.TryGetValue(changed.DocumentId, out var existing):
                    _documents[changed.DocumentId] = existing with { Data = changed.Data };
                    break;
                case DocumentApproved approved when _documents.TryGetValue(approved.DocumentId, out var existing):
                    _documents[approved.DocumentId] = existing with { Approved = true };
                    break;
            }
        }

        return Unit.Default;
    }

    public OptionAsync<TAggregate> LoadAggregateAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => OptionAsync<TAggregate>.None;

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull
    {
        if (projectionId is Guid documentId && _documents.TryGetValue(documentId, out var dto) && dto is TProjection projection)
        {
            return OptionAsync<TProjection>.Some(projection);
        }

        return OptionAsync<TProjection>.None;
    }
}
