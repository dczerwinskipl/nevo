using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

public class AggregateDeciderTests
{
    [Fact]
    public async Task DecideAsync_WhenCalledWithCommandAvailableForAggregateState_ShouldReturnNewEvents()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var decider = new AggregateDecider([typeof(DocumentAggregateBase)]);
        var data = "Data";

        // act
        var result = await decider.DecideAsync(
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
        var decider = new AggregateDecider([typeof(DocumentAggregateBase)]);

        // act
        var result = await decider.DecideAsync(
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
