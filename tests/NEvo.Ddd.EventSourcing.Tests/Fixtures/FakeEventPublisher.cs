using LanguageExt;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A minimal IEventPublisher test double that records every published event and always
// succeeds — used by executor tests that need a real publish step without wiring the
// full messaging pipeline (IMessagePublishStrategyFactory, IMessageContextAccessor, ...).
public class FakeEventPublisher : IEventPublisher
{
    public List<Event> PublishedEvents { get; } = [];

    public Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken)
    {
        PublishedEvents.Add(@event);
        return Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }
}
