using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

public class AggregateDeciderExtractorTests
{
    [Fact]
    public void ExtractDeciders_DecisionMethodProducesAnIAggregateEventThatIsNotAnEvent_ThrowsWithAClearMessage()
    {
        Action act = () => AggregateDeciderExtractor.ExtractDeciders(typeof(MisconfiguredAggregate)).ToList();

        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*{nameof(MisconfiguredAggregate.Create)}*")
            .WithMessage($"*{nameof(NonEventDeciderOutput)}*");
    }
}
