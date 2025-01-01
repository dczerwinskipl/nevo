using NEvo.Ddd.EventSourcing;
using NEvo.Gdpr.Consents.ValueObjects;

namespace NEvo.Gdpr.Consents.Aggregates;

internal abstract record Consent(ConsentId Id) : EventSourcedAggregate<ConsentId>(Id)
{
    internal record EmptyConsent(ConsentId Id) : Consent(Id);
    internal record ActiveConsent(ConsentId Id, ConsentTypeId TypeId, ConsenterId ConsentBy, DateTimeOffset ConsentDate) : Consent(Id);
    internal record WithdrawnConsent(ConsentId Id, ConsentTypeId TypeId, ConsenterId ConsentBy, DateTimeOffset ConsentDate, DateTimeOffset WithdrawnDate) : Consent(Id);
}
