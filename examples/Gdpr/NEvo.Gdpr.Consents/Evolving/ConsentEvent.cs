using NEvo.Ddd.EventSourcing;
using NEvo.Gdpr.Consents.ValueObjects;

namespace NEvo.Gdpr.Consents.Evolving;

internal record ConsentEvent(ConsentId AggregateId) : EventSourcedEvent<ConsentId>(AggregateId)
{
    internal record ConsentGiven(ConsentId AggregateId, ConsentTypeId TypeId, ConsenterId ConsentBy, DateTimeOffset ConsentDate) : ConsentEvent(AggregateId);
    internal record ConsentWithdrawn(ConsentId AggregateId, DateTimeOffset WithdrawnDate) : ConsentEvent(AggregateId);
}
