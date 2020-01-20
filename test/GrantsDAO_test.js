const { BN, constants, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('GrantsDAO', (accounts) => {
  const GrantsDAO = artifacts.require('GrantsDAO')
  const SNXToken = artifacts.require('MockToken')

  const defaultAccount = accounts[0]
  const teamMember1 = accounts[1]
  const teamMember2 = accounts[2]
  const communityMember1 = accounts[3]
  const communityMember2 = accounts[4]
  const communityMember3 = accounts[5]
  const stranger = accounts[6]
  const teamMembers = [teamMember1, teamMember2]
  const communityMembers = [communityMember1, communityMember2, communityMember3]

  const toPass = new BN(4)
  const oneToken = web3.utils.toWei('1')
  const tokenName = 'Synthetix Network Token'
  const tokenSymbol = 'SNX'
  const tokenDecimals = new BN(18)
  const tokenInitialSupply = web3.utils.toWei('1000')
  const after1Day = 86401
  const after2Days = 172801
  const after9Days = 777601

  let dao, snx

  beforeEach(async () => {
    snx = await SNXToken.new(
      tokenName,
      tokenSymbol,
      tokenDecimals,
      tokenInitialSupply,
      { from: defaultAccount },
    )
    dao = await GrantsDAO.new(
      snx.address,
      teamMembers,
      communityMembers,
      toPass,
      { from: defaultAccount },
    )
  })

  describe('constructor', () => {
    it('deploys with the specified addresses as signers', async () => {
      teamMembers.forEach(async s => assert.isTrue(await dao.teamMembers.call(s)))
      communityMembers.forEach(async s => assert.isTrue(await dao.communityMembers.call(s)))
    })

    it('deploys with the specified token address', async () => {
      assert.equal(snx.address, await dao.SNX.call())
    })

    it('deploys with the correct members count', async () => {
      const memberCount = teamMembers.length + communityMembers.length
      assert.equal(memberCount, await dao.members.call())
    })

    it('deploys with the specified toPass value', async () => {
      assert.isTrue(toPass.eq(await dao.toPass.call()))
    })

    context('when toPass is more than members', () => {
      it('reverts in general case', async () => {
        const memberCount = teamMembers.length + communityMembers.length + 1
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            teamMembers,
            communityMembers,
            new BN(memberCount),
            { from: defaultAccount },
          ),
          'Not enough members to pass votes',
        )
      })

      it('reverts when equal to communityMembers length', async () => {
        const memberCount = communityMembers.length
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            teamMembers,
            communityMembers,
            new BN(memberCount),
            { from: defaultAccount },
          ),
          'Need higher value for toPass',
        )
      })

      it('reverts when less than communityMembers length', async () => {
        const memberCount = communityMembers.length - 1
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            teamMembers,
            communityMembers,
            new BN(memberCount),
            { from: defaultAccount },
          ),
          'Need higher value for toPass',
        )
      })
    })

    context('when teamMembers is 0', () => {
      it('reverts', async () => {
        const noMembers = []
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            noMembers,
            communityMembers,
            new BN(communityMembers.length),
            { from: defaultAccount },
          ),
          'Need at least one teamMember',
        )
      })
    })
  })

  describe('createProposal', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.createProposal(stranger, oneToken, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('and the DAO is not funded', () => {
        it('reverts', async () => {
          await expectRevert(
            dao.createProposal(stranger, oneToken, { from: teamMember1 }),
            'Invalid funds on DAO',
          )
        })
      })

      context('and the DAO is funded', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
        })

        it('emits the NewProposal event', async () => {
          const tx = await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          expectEvent(tx.receipt, 'NewProposal', {
            receiver: stranger,
            amount: oneToken,
            proposalNumber: new BN(1),
          })
        })

        it('creates a proposal', async () => {
          await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          const proposal = await dao.proposals(1)
          assert.equal(oneToken.toString(), proposal.amount.toString())
          assert.equal(stranger, proposal.receiver)
          assert.isTrue(proposal.createdAt.gt(0))
        })

        it('reverts for 0 in amount', async () => {
          await expectRevert(
            dao.createProposal(stranger, 0, { from: teamMember1 }),
            'Amount must be greater than 0',
          )
        })

        it('reverts for zero address in receiver', async () => {
          await expectRevert(
            dao.createProposal(constants.ZERO_ADDRESS, oneToken, { from: teamMember1 }),
            'Receiver cannot be zero address',
          )
        })

        it('adds to the locked amount', async () => {
          await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          assert.isTrue(new BN(oneToken).eq(await dao.locked.call()))
          assert.isTrue(new BN(0).eq(await dao.withdrawable.call()))
        })

        it('counts the proposal as voted by the proposer', async () => {
          await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          assert.isTrue(await dao.voted.call(teamMember1, 1))
        })

        context('when proposed by a team member', () => {
          let proposal

          beforeEach(async () => {
            await dao.createProposal(stranger, oneToken, { from: teamMember1 })
            proposal = await dao.proposals.call(1)
          })

          it('marks the proposal as approved by the team', async () => {
            assert.isTrue(proposal.teamApproval)
          })
        })

        context('when proposed by a community member', () => {
          let proposal

          beforeEach(async () => {
            await dao.createProposal(stranger, oneToken, { from: communityMember1 })
            proposal = await dao.proposals.call(1)
          })

          it('does not mark the proposal as approved by the team', async () => {
            assert.isFalse(proposal.teamApproval)
          })
        })

        context('when another proposal is created without additional funding', () => {
          beforeEach(async () => {
            await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          })

          it('reverts', async () => {
            await expectRevert(
              dao.createProposal(stranger, oneToken, { from: teamMember1 }),
              'Invalid funds on DAO',
            )
          })
        })
      })
    })
  })

  describe('voteProposal', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
      await dao.createProposal(stranger, oneToken, { from: communityMember3 })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.voteProposal(1, true, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('when the proposal is still in submission phase', () => {
        it('reverts', async () => {
          await expectRevert(
            dao.voteProposal(1, true, { from: communityMember1 }),
            'Proposal not in voting phase',
          )
        })
      })

      context('when the proposal is outside of voting phase', () => {
        beforeEach(async () => {
          await time.increase(after9Days)
        })

        it('reverts', async () => {
          await expectRevert(
            dao.voteProposal(1, true, { from: communityMember1 }),
            'Proposal not in voting phase',
          )
        })
      })

      context('when the proposal is inside the voting phase', () => {
        beforeEach(async () => {
          await time.increase(after2Days)
        })

        it('allows the proposal to be voted on', async () => {
          const tx = await dao.voteProposal(1, true, { from: communityMember1 })
          expectEvent(tx, 'VoteProposal', {
            proposal: new BN(1),
            member: communityMember1,
            vote: true,
          })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(2).eq(proposal.approvals))
          assert.isTrue(await dao.voted.call(communityMember1, 1))
        })

        it('allows a team member to delete a proposal by voting false', async () => {
          const tx = await dao.voteProposal(1, false, { from: teamMember1 })
          expectEvent(tx, 'DeleteProposal', {
            proposalNumber: new BN(1),
          })
          const deleted = await dao.proposals.call(1)
          assert.equal(deleted.receiver, constants.ZERO_ADDRESS)
          assert.isTrue(deleted.amount.eq(new BN(0)))
          assert.isTrue(deleted.createdAt.eq(new BN(0)))
          assert.isTrue(deleted.approvals.eq(new BN(0)))
        })

        context('when the proposal has already been voted on by a member', () => {
          it('reverts', async () => {
            await expectRevert(
              dao.voteProposal(1, true, { from: communityMember3 }),
              'Already voted',
            )
          })
        })

        context('when all the community members have voted', () => {
          let proposal

          beforeEach(async () => {
            await dao.voteProposal(1, true, { from: communityMember2 })
            await dao.voteProposal(1, true, { from: communityMember1 })
            proposal = await dao.proposals.call(1)
            assert.isFalse(proposal.teamApproval)
            assert.isTrue(new BN(3).eq(proposal.approvals))
          })

          it('does not execute the proposal until a team member approves', async () => {
            const tx = await dao.voteProposal(1, true, { from: teamMember1 })
            expectEvent(tx.receipt, 'ExecuteProposal', {
              receiver: proposal.receiver,
              amount: proposal.amount,
            })
          })
        })

        context('when enough votes have been reached to pass', () => {
          let tx, proposal

          beforeEach(async () => {
            proposal = await dao.proposals.call(1)
            await dao.voteProposal(1, true, { from: teamMember2 })
            await dao.voteProposal(1, true, { from: communityMember1 })
            tx = await dao.voteProposal(1, true, { from: communityMember2 })
          })

          it('emits the ExecuteProposal event', async () => {
            expectEvent(tx.receipt, 'ExecuteProposal', {
              receiver: proposal.receiver,
              amount: proposal.amount,
            })
          })

          it('deletes the proposal from storage', async () => {
            const deleted = await dao.proposals.call(1)
            assert.equal(deleted.receiver, constants.ZERO_ADDRESS)
            assert.isTrue(deleted.amount.eq(new BN(0)))
            assert.isTrue(deleted.createdAt.eq(new BN(0)))
            assert.isTrue(deleted.approvals.eq(new BN(0)))
          })

          it('sends the proposal amount to the receiver', async () => {
            assert.isTrue(new BN(oneToken).eq(await snx.balanceOf(stranger)))
          })
        })
      })
    })

    context('when multiple proposals are active', () => {
      beforeEach(async () => {
        await time.increase(after1Day)
        await snx.transfer(dao.address, oneToken, { from: defaultAccount })
        await dao.createProposal(stranger, oneToken, { from: communityMember3 })
      })

      it('does not allow early voting for either proposal', async () => {
        await expectRevert(
          dao.voteProposal(1, true, { from: communityMember1 }),
          'Proposal not in voting phase',
        )
        await expectRevert(
          dao.voteProposal(2, true, { from: communityMember1 }),
          'Proposal not in voting phase',
        )
      })

      context('when one proposal is in the voting phase', () => {
        beforeEach(async () => {
          await time.increase(after1Day)
          assert.isTrue(await dao.votingPhase.call(1))
          assert.isFalse(await dao.votingPhase.call(2))
        })

        it('only allows voting for valid proposals', async () => {
          const tx = await dao.voteProposal(1, true, { from: communityMember1 })
          expectEvent(tx, 'VoteProposal', {
            proposal: new BN(1),
            member: communityMember1,
            vote: true,
          })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(2).eq(proposal.approvals))
          assert.isTrue(await dao.voted.call(communityMember1, 1))
        })

        it('does not allow voting for proposals that are still in submission phase', async () => {
          await expectRevert(
            dao.voteProposal(2, true, { from: communityMember1 }),
            'Proposal not in voting phase',
          )
        })

        it('allows proposals in the voting phase to be executed', async () => {
          const proposal1 = await dao.proposals.call(1)
          await dao.voteProposal(1, true, { from: communityMember1 })
          await dao.voteProposal(1, true, { from: communityMember2 })
          const tx = await dao.voteProposal(1, true, { from: teamMember2 })
          expectEvent(tx.receipt, 'ExecuteProposal', {
            receiver: proposal1.receiver,
            amount: proposal1.amount,
          })

          const proposal2 = await dao.proposals.call(2)
          assert.equal(oneToken.toString(), proposal2.amount.toString())
          assert.equal(stranger, proposal2.receiver)
          assert.isTrue(proposal2.createdAt.gt(0))
        })
      })
    })
  })

  describe('deleteProposal', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
      await dao.createProposal(stranger, oneToken, { from: teamMember1 })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.deleteProposal(1, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('when the proposal is not expired', () => {
        it('reverts', async () => {
          await expectRevert(
            dao.deleteProposal(1, { from: teamMember1 }),
            'Proposal not expired',
          )
        })
      })

      context('when the proposal is expired', () => {
        beforeEach(async () => {
          await time.increase(after9Days)
        })

        it('emits the DeleteProposal event', async () => {
          const tx = await dao.deleteProposal(1, { from: teamMember1 })
          expectEvent(tx.receipt, 'DeleteProposal', {
            proposalNumber: new BN(1),
          })
        })

        it('unlocks the proposal amount', async () => {
          await dao.deleteProposal(1, { from: teamMember1 })
          assert.isTrue(new BN(0).eq(await dao.locked.call()))
        })
      })
    })
  })

  describe('withdrawable', () => {
    context('when the contract is not funded', () => {
      it('returns 0', async () => {
        assert.isTrue(new BN(0).eq(await dao.withdrawable.call()))
      })

      context('when the contract is funded', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
        })

        it('returns the amount that was funded', async () => {
          assert.isTrue(new BN(oneToken).eq(await dao.withdrawable.call()))
        })

        context('when a proposal is created', () => {
          beforeEach(async () => {
            await snx.transfer(dao.address, oneToken, { from: defaultAccount })
            await dao.createProposal(stranger, oneToken, { from: teamMember1 })
          })

          it('returns the balance minus what is locked in the proposal', async () => {
            assert.isTrue(new BN(oneToken).eq(await dao.withdrawable.call()))
          })
        })
      })
    })
  })

  describe('withdraw', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
    })

    context('when called by a community member', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.withdraw(stranger, oneToken, { from: communityMember1 }),
          'Not team member',
        )
      })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.withdraw(stranger, oneToken, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('allows funds to be withdrawn', async () => {
        await dao.withdraw(stranger, oneToken, { from: teamMember1 })
        assert.isTrue(new BN(oneToken).eq(await snx.balanceOf(stranger)))
        assert.isTrue(new BN(0).eq(await snx.balanceOf(dao.address)))
      })

      context('when a proposal is created', () => {
        beforeEach(async () => {
          await dao.createProposal(stranger, oneToken, { from: teamMember1 })
        })

        it('does not allow locked funds to be withdrawn', async () => {
          assert.isTrue(new BN(oneToken).eq(await snx.balanceOf(dao.address)))
          assert.isTrue(new BN(0).eq(await dao.withdrawable.call()))
          await expectRevert(
            dao.withdraw(stranger, oneToken, { from: teamMember1 }),
            'Unable to withdraw amount',
          )
        })
      })
    })
  })

  describe('addCommunityMember', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.addCommunityMember(stranger, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('adds the member as a proposer', async () => {
        await dao.addCommunityMember(stranger, { from: teamMember1 })
        assert.isTrue(await dao.communityMembers.call(stranger))
      })

      it('increments the value for toPass', async () => {
        await dao.addCommunityMember(stranger, { from: teamMember1 })
        assert.isTrue(new BN(5).eq(await dao.toPass.call()))
      })

      context('when members have already voted on a proposal', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
          await dao.createProposal(stranger, oneToken, { from: communityMember1 })
          await time.increase(after2Days)
          await dao.voteProposal(1, true, { from: communityMember2 })
          await dao.voteProposal(1, true, { from: communityMember3 })
          await dao.addCommunityMember(stranger, { from: teamMember1 })
        })

        it('does not execute the proposal when the new member votes', async () => {
          await dao.voteProposal(1, true, { from: stranger })
          const proposal = await dao.proposals.call(1)
          assert.isFalse(proposal.teamApproval)
          assert.equal(proposal.receiver, stranger)
        })
      })
    })
  })
})
