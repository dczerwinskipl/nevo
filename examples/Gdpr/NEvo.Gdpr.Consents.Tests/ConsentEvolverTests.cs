using NEvo.Gdpr.Consents.Tests;

namespace NEvo.Gdpr.Consents.Evolving.Tests;

public class ConsentEvolverTests
{
    private static ConsentId _consentId = new(Guid.NewGuid());
    private static ConsentTypeId _consentTypeId = new(Guid.NewGuid());
    private static ConsenterId _consenterId = new(Guid.NewGuid());

    [Fact]
    public void Empty_ShouldCreateEmptyConsent()
    {
        // Arrange
        var @event = new ConsentEvent(_consentId);

        // Act
        var consent = ConsentEvolver.Empty(@event);

        // Assert
        consent.Should().BeOfType<EmptyConsent>();
        consent.Should().BeEquivalentTo(new { Id = _consentId });
    }

    [Fact]
    public void GiveConsent_ShouldCreateActiveConsent()
    {
        // Arrange
        var aggregate = new EmptyConsent(_consentId);
        var @event = new ConsentGiven(_consentId, _consentTypeId, _consenterId, DateTimeOffset.UtcNow);

        // Act
        var result = ConsentEvolver.GiveConsent(aggregate, @event);

        // Assert
        result.Should().BeRight()
            .Which.Should().BeOfType<ActiveConsent>()
            .And.BeEquivalentTo(new { 
                Id = _consentId,
                TypeId = _consentTypeId,
                ConsentBy = _consenterId,
                @event.ConsentDate
            });
    }

    [Fact]
    public void GiveConsent_WhenConsentIsNotEmpty_ShouldThrowException()
    {
        // Arrange
        var aggregate = new ActiveConsent(_consentId, _consentTypeId, _consenterId, DateTimeOffset.UtcNow);
        var @event = new ConsentGiven(_consentId, _consentTypeId, _consenterId, DateTimeOffset.UtcNow);

        // Act
        var result = ConsentEvolver.GiveConsent(aggregate, @event);

        // Assert
        result.Should().BeLeft();
    }

    [Fact]
    public void WithdrawConsent_ShouldCreateWithdrawnConsent()
    {
        // Arrange
        var aggregate = new ActiveConsent(_consentId, _consentTypeId, _consenterId, DateTimeOffset.UtcNow);
        var @event = new ConsentWithdrawn(_consentId, DateTimeOffset.UtcNow);

        // Act
        var result = ConsentEvolver.WithdrawConsent(aggregate, @event);

        // Assert
        result.Should().BeRight()
            .Which.Should().BeOfType<WithdrawnConsent>()
            .And.BeEquivalentTo(new
            {
                Id = _consentId,
                TypeId = _consentTypeId,
                ConsentBy = _consenterId,
                aggregate.ConsentDate,
                @event.WithdrawnDate
            });
    }

    [Fact]
    public void WithdrawConsent_WhenConsentIsNotActive_ShouldThrowException()
    {
        // Arrange
        var aggregate = new EmptyConsent(_consentId);
        var @event = new ConsentWithdrawn(_consentId, DateTimeOffset.UtcNow);

        // Act
        var result = ConsentEvolver.WithdrawConsent(aggregate, @event);

        // Assert
        result.Should().BeLeft();
    }
}
