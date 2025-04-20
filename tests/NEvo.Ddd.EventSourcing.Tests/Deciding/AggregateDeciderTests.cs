using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

public class AggregateDeciderTests
{
    private AggregateDecider _decider;

    public AggregateDeciderTests()
    {
        var configuration = new AggregateExtractorConfiguration()
        {
            AggregateTypes = { typeof(DocumentAggregateBase) }
        };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        _decider = new AggregateDecider(deciderProvider);
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithCommandAvailableForAggregateState_ShouldReturnNewEvents()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var data = "Data";

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new CreateDocument(aggregate.Id, data),
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeEquivalentTo(
                [new DocumentCreated(aggregate.Id, data)],
                options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
            );
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithCommandNotAvailableForAggregateState_ShouldReturnError()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new ChangeDocument(aggregate.Id, "Data"),
            CancellationToken.None
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<Exception>().Which
            .Message.Should().Contain("No decider found for command ChangeDocument on aggregate EmptyDocument");
    }
}
