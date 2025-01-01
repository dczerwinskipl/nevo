using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Gdpr.Consents.Aggregates;
using static NEvo.Gdpr.Consents.Evolving.ConsentEvent;

namespace NEvo.Gdpr.Consents.Evolving;

internal static class ConsentEvolver
{
    [EmptyHandler]
    internal static Consent Empty(ConsentEvent @event) 
        => new Consent.EmptyConsent(@event.AggregateId);

    [EvolutionHandler]
    internal static Either<Exception, Consent> GiveConsent(Consent aggregate, ConsentGiven @event)
    {
        if (aggregate is not Consent.EmptyConsent)
        {
            return new InvalidOperationException("Cannot give consent to a non-empty consent.");
        }

        return new Consent.ActiveConsent(@event.AggregateId, @event.TypeId, @event.ConsentBy, @event.ConsentDate);
    }

    [EvolutionHandler]
    internal static Either<Exception, Consent> WithdrawConsent(Consent aggregate, ConsentWithdrawn @event)
    {
        if (aggregate is not Consent.ActiveConsent activeConsent)
        {
            return new InvalidOperationException("Cannot withdraw consent from a non-active consent.");
        }

        return new Consent.WithdrawnConsent(@event.AggregateId, activeConsent.TypeId, activeConsent.ConsentBy, activeConsent.ConsentDate, @event.WithdrawnDate);
    }
}
